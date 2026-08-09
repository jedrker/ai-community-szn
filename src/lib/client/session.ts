import * as Ably from "ably";

import type { SessionState } from "../session/state";

/**
 * The spine contract's client rule, implemented once (roadmap S-02).
 *
 * Every LiveQuiz view — `/quiz`, `/quiz/host`, and everything S-03 through S-08 adds
 * — needs the same three behaviours: prime from the state endpoint, subscribe to the
 * channel, and apply whichever snapshot carries the higher `version`. `spine-check.astro`
 * proved the shape inline; two views inlining it would be two places for it to drift,
 * and the reconciliation rule is exactly the kind of thing that drifts silently — a view
 * that gets it wrong looks fine until a message arrives out of order on stage.
 *
 * ## What may and may not be imported here
 *
 * This module ships to a phone. It takes the channel and event names as **arguments**
 * rather than importing them from `src/lib/session/keys.ts`, and it imports
 * `SessionState` as a **type only**. Both are enforced by `boundary.test.ts`, and both
 * matter: a value import from `src/lib/session/` drags server-side env reads and `zod`
 * into the bundle, and a value import from `src/quiz/` would put all fourteen answers in
 * it. The views pass the names down through `define:vars`.
 *
 * ## No framework, deliberately
 *
 * This is the concrete half of Open Roadmap Question 2's answer: plain TypeScript
 * modules imported by Astro `<script>` tags. The bundle is essentially the Ably SDK,
 * which is what protects the unmeasured 30-second join target on a venue network. The
 * accepted cost is that S-07 and S-08 will hand-write their DOM updates.
 */

/** A session document, or `null` when there is no session at all. */
export type Snapshot = SessionState | null;

/**
 * Where an applied snapshot came from.
 *
 * `http` covers the join response and the host action response — both carry
 * authoritative state, and both must go through the same version check as the channel,
 * or a view could render a snapshot older than the one it already holds.
 */
export type SnapshotSource = "fetch" | "realtime" | "http";

/**
 * Three states, and the third is the point.
 *
 * A device must be able to tell "waiting for the host" (connected, lobby) from "the
 * segment is over" (connected, `ended`) from "my connection died" (`lost`). The same
 * reasoning that made `ended` a phase rather than an absent session applies to the
 * transport: collapse any two of these and a broken screen is indistinguishable from a
 * quiet one at the moment the segment is meant to land.
 */
/**
 * Four states, and the fourth is the one that keeps a room playable.
 *
 * A device must be able to tell "waiting for the host" from "the segment is over" from
 * "my connection died" — and, since the connection-limit change, from "the channel is
 * gone but I am still being served over HTTP". `degraded` is that last one: snapshots
 * arrive on a timer instead of instantly, which is worse than `connected` and enormously
 * better than `lost`, because everything an attendee actually does — joining, answering,
 * fetching their result — is HTTP and unaffected.
 *
 * **`degraded` is earned, never assumed.** It is reported only after a fallback fetch has
 * actually succeeded. Announcing it on the strength of Ably dropping would put a calm
 * amber banner on a device that is simply offline, which is the same class of lie as
 * telling a full room it is reconnecting.
 */
export type ConnectionStatus = "connecting" | "connected" | "degraded" | "lost";

/**
 * *Why* the transport is unhealthy, which is a different question from *that* it is.
 *
 * `"account-limit"` means Ably refused because this account has hit a ceiling — most
 * plausibly the free tier's 200 peak connections in a room larger than ~180
 * (`context/foundation/infrastructure.md`). `"transient"` is everything else that lands
 * on `lost`: the venue network, a dropped socket, a device that walked out of range.
 *
 * The distinction is not cosmetic. A transient drop is something the SDK retries and an
 * attendee can wait out; an exhausted account limit is not, and the only person who can
 * act on it is the host. Rendering both as one red "reconnecting" line tells the room a
 * device is broken when the account is full, and tells the host nothing they can use.
 *
 * `null` on a healthy or still-opening connection — there is no cause to report.
 */
export type ConnectionCause = "account-limit" | "transient" | null;

/** Everything a view needs to describe the connection beyond its status. */
export type ConnectionInfo = {
  /**
   * Ably's own state name, verbatim. The host view prints it, so it stays a raw
   * transport word rather than something translated or folded.
   */
  readonly detail: string;
  readonly cause: ConnectionCause;
  /**
   * The Ably error code behind `cause`, or `null` when the transition carried none.
   * Surfaced so the host's screen can be matched against Ably's dashboard — an
   * unexplained red line is what this whole classification exists to remove.
   */
  readonly code: number | null;
};

/**
 * Ably error codes that mean "this account has hit a ceiling", not "the network
 * wobbled". Spelled out because the numbers are unreadable otherwise, and because the
 * set is the entire definition of `"account-limit"`.
 *
 * @see https://ably.com/docs/platform/errors/codes
 */
const ACCOUNT_LIMIT_CODES = new Set([
  40111, // Connection limits exceeded — the hard peak-connection ceiling
  40115, // Account restricted (request limit exceeded)
  42910, // Rate limit exceeded; request rejected
  42911, // Rate limit exceeded; connection closed
]);

export type SessionClientOptions = {
  /** From `define:vars`, never imported — see the module docstring. */
  readonly channelName: string;
  readonly snapshotEvent: string;
  /** Called for every snapshot that wins the version check, and only those. */
  readonly onSnapshot: (state: Snapshot, source: SnapshotSource) => void;
  readonly onConnection?: (status: ConnectionStatus, info: ConnectionInfo) => void;
  /**
   * The live join count from `/api/quiz/state`, called on every successful fetch —
   * **including one whose snapshot the version check dropped.**
   *
   * That exemption is the whole reason this is a separate callback. The count is
   * informational and deliberately stale-tolerant, while the version guard exists to
   * order flow state; routing the count through the guard means a refresh that returns
   * the same version reports nothing, which is exactly how the host's refresh button
   * came to show an empty lobby in the Phase 4 two-device run.
   *
   * `null` means the server could not find out. Keep the previous number.
   */
  readonly onCount?: (count: number | null) => void;
  /**
   * Whether to fall back to polling `/api/quiz/state` when the channel is unavailable.
   *
   * Opt-in and defaulting to off, so the type change is additive and a future view has to
   * decide deliberately whether it wants to spend requests this way. Both LiveQuiz views
   * turn it on: the attendee's because a device Ably refused can still play, the host's
   * because it is the one device whose failure stops the room.
   */
  readonly fallbackPolling?: boolean;
};

export type SessionClient = {
  /** The snapshot currently held, for a caller that needs it between callbacks. */
  readonly current: () => Snapshot;
  /**
   * Feeds a snapshot that arrived over HTTP through the same reconciliation the
   * channel goes through. Returns whether it was applied.
   */
  readonly apply: (state: Snapshot, source: SnapshotSource) => boolean;
  /** Re-reads `/api/quiz/state`. Rejects on failure, so an explicit refresh can say so. */
  readonly refresh: () => Promise<void>;
  /** Primes from the state endpoint, then connects and subscribes. */
  readonly start: () => Promise<void>;
  readonly close: () => void;
};

/**
 * Ably's connection state and error code, folded into what a view can render.
 *
 * The status half is unchanged and deliberately coarse: `initialized` and `connecting`
 * are the opening moments; `connected` is the only healthy one; everything else —
 * `disconnected`, `suspended`, `closing`, `closed`, `failed` — is a device that is not
 * receiving snapshots, which from the attendee's side is one situation.
 *
 * **The cause is read from the error code, never from the state.** Ably's documentation
 * does not commit `40111` to a particular connection state — a limit rejection may
 * arrive as `failed` or as `disconnected` depending on where in the handshake it lands —
 * so branching on the state would be a guess dressed as a rule. The code is exact.
 *
 * Pure and exported so the mapping can be tested without an Ably instance: it is a
 * lookup table of magic numbers, which is precisely the kind of thing that rots without
 * anything failing.
 */
export function classifyConnection(
  state: string,
  code: number | undefined
): { status: ConnectionStatus; info: ConnectionInfo } {
  const status: ConnectionStatus =
    state === "connected"
      ? "connected"
      : state === "initialized" || state === "connecting"
        ? "connecting"
        : "lost";

  /**
   * **A healthy connection has no cause, whatever code came with the transition.** Ably
   * reports the *previous* failure's reason on the change that recovers from it, so
   * without this guard a room that briefly hit its limit and then recovered would keep
   * rendering the limit message over a working connection.
   *
   * `connecting` is deliberately *not* guarded the same way: a retry loop carrying an
   * account-limit code is exactly when naming the cause is most useful to the host.
   */
  const cause: ConnectionCause =
    status === "connected"
      ? null
      : code !== undefined && ACCOUNT_LIMIT_CODES.has(code)
        ? "account-limit"
        : status === "lost"
          ? "transient"
          : null;

  return { status, info: { detail: state, cause, code: code ?? null } };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * THE PROJECT'S SECOND POLLING LOOP, and the numbers that make it defensible.
 *
 * `/quiz/host`'s participation counter is the first (see its own docstring). This one is
 * bounded differently: it runs on **any** device whose channel is unavailable, but only
 * while it is unavailable, and it stops at the end of the session.
 *
 * Each tick costs two Redis commands — `GET` plus the `HLEN` behind `playerCount`
 * (`src/pages/api/quiz/state.ts`). The expected case, ~20 devices refused above the Ably
 * free tier's 200-connection ceiling, is ~7k commands across a 15-minute segment. The
 * worst case, Ably unreachable for an entire 220-device room, is ~66k. The free tier is
 * 500k a month, and the runbook's tripwire is 200k attributable to one run — so both sit
 * inside it, and saying so here is what stops the next reader diagnosing this loop as the
 * runaway that tripwire watches for.
 *
 * **The jitter is not decoration.** Every device refused by a connection limit is refused
 * within the same second or two, so a fixed interval would keep the whole cohort polling
 * in lockstep for the entire segment — 20 simultaneous requests every 6 s instead of a
 * spread. It also has to be a *symmetric* spread around the base rather than a delay
 * added to it, or the interval quietly becomes longer than the number written here.
 */
const POLL_BASE_MS = 6_000;
const POLL_JITTER_MS = 1_500;
/**
 * How many consecutive failed polls demote a `degraded` device back to `lost`.
 *
 * Two, ~12 s. One is too eager: a single failure on a venue network is ordinary, and
 * flashing red on each one reads as a broken app. Never demoting is worse than either —
 * a device that has genuinely gone offline would keep a calm amber banner over a question
 * that has since been replaced, which is the exact silence `lost` exists to break.
 */
const POLL_FAILURES_BEFORE_LOST = 2;

export type FallbackPoll = {
  /** Schedule one tick, if every condition for polling currently holds. */
  readonly arm: () => void;
  /** Cancel any scheduled tick and drop out of `degraded`. */
  readonly stop: () => void;
  /** Whether a tick is scheduled. Exposed so a test can assert the loop's lifecycle. */
  readonly isArmed: () => boolean;
};

/**
 * The fallback loop, built without any knowledge of Ably.
 *
 * Separated from `createSessionClient` for one reason: **the seam has to be testable.** A
 * timer whose only entry point is an Ably connection callback can be exercised only by
 * mocking the SDK, and a mock of a third-party client freezes its API and keeps passing
 * after a real upgrade breaks production. With the loop standing on its own, its whole
 * lifecycle — promotion, demotion, cancellation, the single-timer invariant — is testable
 * against a stub `refresh` and nothing else.
 *
 * `shouldPoll` is asked on every arm rather than captured once, because every reason to
 * stop (the channel recovered, the session ended, the caller never opted in) is a moving
 * fact owned by the caller.
 */
export function createFallbackPoll(deps: {
  readonly refresh: () => Promise<void>;
  readonly shouldPoll: () => boolean;
  readonly onDegraded: (degraded: boolean) => void;
}): FallbackPoll {
  let timer: number | null = null;
  let inFlight = false;
  let failures = 0;
  let degraded = false;

  /** Symmetric spread around the base, so the average interval stays `POLL_BASE_MS`. */
  const delay = (): number => POLL_BASE_MS + (Math.random() * 2 - 1) * POLL_JITTER_MS;

  const setDegraded = (next: boolean): void => {
    if (degraded === next) return;
    degraded = next;
    deps.onDegraded(next);
  };

  /**
   * Arm one tick, or decline to.
   *
   * Every reason not to poll lives here, so the poll body can simply return and its
   * `finally` can re-arm unconditionally — the arrangement `/quiz/host`'s participation
   * loop uses, and the reason that one has never stacked two timers.
   */
  const arm = (): void => {
    // Never two timers, and never a timer stacked behind a request that has not come
    // back. A connection that flaps calls this several times per retry cycle, and each
    // one would otherwise add a loop: the screen would look right while the spend
    // doubled, then quadrupled.
    if (timer !== null || inFlight) return;
    if (!deps.shouldPoll()) return;
    // A backgrounded tab is not polled. `visibilitychange` in the caller restarts it —
    // without that, a phone locked mid-segment would come back to a dead loop.
    if (document.visibilityState === "hidden") return;

    timer = window.setTimeout(() => {
      timer = null;
      void tick();
    }, delay());
  };

  /**
   * One fallback fetch, and the promotion/demotion rule around it.
   *
   * A success promotes to `degraded`: the first one is the only evidence that HTTP works
   * while the channel does not, which is the "earned, never assumed" rule stated on
   * `ConnectionStatus`. `POLL_FAILURES_BEFORE_LOST` consecutive failures demote, and the
   * loop keeps running either way so a device can climb back.
   */
  const tick = async (): Promise<void> => {
    if (inFlight) return;
    /**
     * **Asked again at fire time, not only at arm time, and the difference is one request
     * per device.** A tick scheduled while the session was live is still queued when the
     * host ends it; without this the timer that was already in flight would spend one more
     * fetch on a session nobody is waiting on — ~220 of them in a full room, right at the
     * moment the store is being purged. Caught by the test, not by review.
     */
    if (!deps.shouldPoll()) return;
    inFlight = true;

    try {
      await deps.refresh();
      failures = 0;
      setDegraded(true);
    } catch {
      failures += 1;
      if (failures >= POLL_FAILURES_BEFORE_LOST) setDegraded(false);
    } finally {
      inFlight = false;
      // The one place a tick is re-armed, so every branch above simply returns. `arm` is
      // conditional, and the condition may have gone false while this request was open —
      // the host ending the session mid-fetch is the ordinary way that happens.
      arm();
    }
  };

  return {
    arm,
    isArmed: () => timer !== null,
    stop: () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      failures = 0;
      setDegraded(false);
    },
  };
}

export function createSessionClient(options: SessionClientOptions): SessionClient {
  let current: Snapshot = null;
  let realtime: Ably.Realtime | null = null;

  /**
   * The single reconciliation rule: apply whichever snapshot carries the higher
   * version, drop anything not newer. It is what makes the prime fetch and the
   * subscription safe to race, and why a device that missed a message is correct again
   * on the next one.
   *
   * **`null` always applies.** It carries no version to compare, and it means the
   * session document is gone — a purge. Refusing it would leave a phone rendering a
   * question that no longer exists, which is the one state nobody can recover from
   * without a reload.
   */
  const apply = (state: Snapshot, source: SnapshotSource): boolean => {
    if (state && current && state.version <= current.version) return false;

    current = state;
    options.onSnapshot(state, source);
    return true;
  };

  const refresh = async (): Promise<void> => {
    const response = await fetch("/api/quiz/state", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`state fetch returned ${response.status}`);
    }

    const body = (await response.json()) as {
      state?: Snapshot;
      playerCount?: number | null;
    };
    apply(body.state ?? null, "fetch");
    // Deliberately outside `apply` — see `onCount` for why the count must not be
    // gated on the snapshot having won the version check.
    options.onCount?.(body.playerCount ?? null);
  };

  /**
   * What the transport last said, held so the fallback can *override* it without
   * forgetting it. `degraded` is a claim about this client's own polling, not about Ably,
   * so the two have to be tracked separately or a recovering channel could not be
   * distinguished from a working fallback.
   */
  let transportStatus: ConnectionStatus = "connecting";
  let transportInfo: ConnectionInfo = { detail: "initialized", cause: null, code: null };
  let degraded = false;

  /**
   * The single place a status reaches the view.
   *
   * `degraded` masks any unhealthy transport status, not just `lost`: Ably cycles through
   * `connecting` while it retries, and without the wider condition the banner would
   * flicker between "backup mode" and "connecting" every retry — motion that reads as
   * instability on a screen whose whole job here is to look calm.
   *
   * `info` is passed through untouched. `detail` stays Ably's own state name because the
   * host prints it verbatim; the fallback announces itself through the *status*, which is
   * the thing views branch on.
   */
  const report = (): void => {
    const status: ConnectionStatus =
      degraded && transportStatus !== "connected" ? "degraded" : transportStatus;
    options.onConnection?.(status, transportInfo);
  };

  /**
   * The three moving facts that decide whether polling is worth doing, asked fresh on
   * every arm. `ended` is what bounds the spend of a phone left face-up on a table after
   * the segment: nothing further will change, so nothing further is fetched.
   */
  const poll = createFallbackPoll({
    refresh: () => refresh(),
    shouldPoll: () =>
      options.fallbackPolling === true &&
      transportStatus !== "connected" &&
      current?.phase !== "ended",
    onDegraded: (next) => {
      degraded = next;
      report();
    },
  });

  /**
   * A backgrounded tab is not polled, and `visibilitychange` is what restarts it.
   *
   * Without the listener a phone that was locked mid-segment would come back to a dead
   * loop and sit on a stale question until reloaded — worse than the spend the hidden
   * check saves.
   */
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") poll.arm();
  };

  const start = async (): Promise<void> => {
    // Prime *before* subscribing. Between two host actions the wait for the next
    // message is unbounded, so a device that only subscribed would sit on an empty
    // screen — and a reload during a fifteen-minute segment is near-certain. The order
    // is load-bearing and documented in `src/pages/api/quiz/state.ts`.
    //
    // A failed prime is not fatal: the subscription still delivers the host's next
    // action, so the view degrades to "waiting" rather than to nothing.
    try {
      await refresh();
    } catch (err) {
      // Not a transport verdict — the subscription has not been opened yet. Reported as
      // still-opening with no cause, because nothing about a failed prime says why.
      options.onConnection?.("connecting", {
        detail: describe(err),
        cause: null,
        code: null,
      });
    }

    // authUrl, never a key: the browser exchanges a short-lived subscribe-only token
    // request with Ably itself, so no credential of this project's ever reaches it.
    realtime = new Ably.Realtime({ authUrl: "/api/quiz/token" });

    realtime.connection.on((change) => {
      /**
       * **`errorReason` is a fallback, not the primary source, and the order matters.**
       * The reason for *this* transition rides on the change; `connection.errorReason`
       * holds the last error the connection saw, which on a later transition may be
       * stale. Read only when the change carries nothing, so a transition that explains
       * itself always wins.
       */
      const code = change.reason?.code ?? realtime?.connection.errorReason?.code;
      const { status, info } = classifyConnection(change.current, code);
      transportStatus = status;
      transportInfo = info;

      /**
       * **A recovered channel clears the fallback; anything else arms it.** Only
       * `connected` stops the loop, deliberately: Ably passes through `connecting` on
       * every retry, and treating that as recovery would cancel the fallback several
       * times a minute for a device that never actually reconnects.
       */
      if (status === "connected") {
        // `stop` clears `degraded` through `onDegraded`, which reports on its own; the
        // report below then carries the recovered status.
        poll.stop();
      } else {
        poll.arm();
      }

      report();
    });

    if (options.fallbackPolling) {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    const channel = realtime.channels.get(options.channelName);
    await channel.subscribe(options.snapshotEvent, (message) => {
      apply((message.data ?? null) as Snapshot, "realtime");
    });
  };

  return {
    current: () => current,
    apply,
    refresh,
    start,
    close: () => {
      realtime?.close();
      realtime = null;
      // The timer and the listener both outlive the connection unless cancelled here. A
      // loop left armed after `close` keeps fetching for a client nobody is reading, and
      // it is the one leak nothing on screen would reveal.
      poll.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
