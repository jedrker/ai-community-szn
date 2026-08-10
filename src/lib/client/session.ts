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
   * A short technical description of where the transport stands, **for display only — never
   * parse it.**
   *
   * Usually Ably's own state name verbatim (`disconnected`, `suspended`, …). Two other
   * producers exist and are why this is documented as a display string rather than as a state
   * name: `channel-failed`, when the connection is up but attaching to the channel was
   * refused, and the error text of a failed prime fetch, which has no transport state at all.
   * The host view prints whichever arrives; the *status* is the thing to branch on.
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

/**
 * The ceiling the interval backs off to while polls keep failing, doubling from
 * `POLL_BASE_MS` and resetting on the first success. Mirrors `/quiz/host`'s participation
 * loop, which uses the same two numbers for the same reason: a permanently unreachable
 * endpoint must not be asked every six seconds for a whole segment.
 *
 * **The cost, stated because it is not free here.** Unlike the host's decorative counter,
 * this loop carries the question an attendee is trying to answer, so a backed-off device is
 * further behind the room. That is tolerable only because demotion to `lost` after
 * `POLL_FAILURES_BEFORE_LOST` failures has already told them the truth — the backoff slows a
 * device that is *already* being described as disconnected, not one holding an amber banner.
 */
const POLL_MAX_MS = 20_000;

/**
 * How long a state fetch is given before it is abandoned.
 *
 * The twin of `answer.ts`'s `REQUEST_TIMEOUT_MS`, same value and same reason: a request
 * that never returns is worse than one that fails, because nothing downstream can tell the
 * difference between the two. Restated rather than imported — the transport must not depend
 * on a feature module for a constant.
 *
 * **The bound matters to the fallback loop specifically.** `inFlight` blocks every re-arm,
 * so without a deadline one hung socket ends the loop permanently: no further ticks, no
 * failure counted, no demotion out of `degraded` — a device frozen behind a banner
 * promising a refresh that will never come. Sized under
 * `POLL_BASE_MS * POLL_FAILURES_BEFORE_LOST` so a hang demotes rather than stalls.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Whether the fallback loop should be running, as a pure predicate.
 *
 * Extracted after a review found that this conjunction — the *only* place the opt-in flag and
 * the end of the session actually bind to the loop — had no test, because the loop's own tests
 * substitute a hand-written `shouldPoll`. Two defects hid in exactly here.
 */
export function shouldFallbackPoll(input: {
  readonly fallbackPolling: boolean | undefined;
  readonly transportStatus: ConnectionStatus;
  readonly sessionOver: boolean;
}): boolean {
  return (
    input.fallbackPolling === true &&
    input.transportStatus !== "connected" &&
    !input.sessionOver
  );
}

/** Whether this client has seen a session, and whether that session is over for good. */
export type SessionLifecycle = {
  readonly sawSession: boolean;
  readonly sessionOver: boolean;
};

export const INITIAL_LIFECYCLE: SessionLifecycle = {
  sawSession: false,
  sessionOver: false,
};

/**
 * Fold one applied snapshot into the lifecycle latch.
 *
 * Three rules, and the first is the one a naive fix gets wrong:
 *
 * - **`null` before any session is not "over".** It is what a device sees before the host has
 *   created a session, and treating it as terminal would strand the very device the fallback
 *   exists for.
 * - **`null` after a session is over.** That is what a purge produces, and it is the case that
 *   made the polling spend unbounded: a condition re-derived from the snapshot reads "not
 *   ended" for a document that no longer exists.
 * - **`sessionOver` is sticky.** A latch, not a test — re-derived on every arm it would re-open
 *   on the next Ably transition, and a lost device emits those for as long as the tab is open.
 *   The accepted cost is recorded at the call site: a purge-and-restart mid-event leaves a
 *   degraded device needing a reload.
 */
export function advanceLifecycle(
  previous: SessionLifecycle,
  state: Snapshot
): SessionLifecycle {
  if (state === null) {
    return {
      sawSession: previous.sawSession,
      sessionOver: previous.sessionOver || previous.sawSession,
    };
  }

  return {
    sawSession: true,
    sessionOver: previous.sessionOver || state.phase === "ended",
  };
}

export type FallbackPoll = {
  /** Schedule one tick, if every condition for polling currently holds. */
  readonly arm: () => void;
  /**
   * Cancel the scheduled tick and **nothing else** — the status, the failure count and the
   * backed-off interval all survive.
   *
   * This is the right response to the page going quiet: a hidden tab or a bfcache
   * suspension. `stop` would be wrong there, because dropping out of `degraded` paints a red
   * "connection lost" on a screen nobody is looking at and then flashes it again on the way
   * back in, for a fallback that was working the whole time.
   */
  readonly pause: () => void;
  /**
   * Cancel the scheduled tick, drop out of `degraded`, and reset the failure count and the
   * interval. **Resumable** — for a channel that recovered, where forgetting the degraded
   * state is exactly the point.
   */
  readonly stop: () => void;
  /**
   * Cancel for good. **Not resumable**, and that is the difference from `stop`: a tick
   * already in flight re-arms from its own `finally`, so a cancel that only clears the timer
   * is undone by a request it never knew about. Nothing is reported — a disposed loop's last
   * act must not be a status update to a caller that is tearing down.
   */
  readonly dispose: () => void;
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
  let disposed = false;

  const clearTimer = (): void => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  /** The current interval before jitter — doubles on failure, resets on success. */
  let base = POLL_BASE_MS;

  /** Symmetric spread around the current base, so the average interval stays `base`. */
  const delay = (): number => base + (Math.random() * 2 - 1) * POLL_JITTER_MS;

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
    if (disposed) return;
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
    if (disposed || inFlight) return;
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
      base = POLL_BASE_MS;
      setDegraded(true);
    } catch {
      failures += 1;
      base = Math.min(base * 2, POLL_MAX_MS);
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
    pause: () => clearTimer(),
    stop: () => {
      clearTimer();
      failures = 0;
      base = POLL_BASE_MS;
      setDegraded(false);
    },
    dispose: () => {
      disposed = true;
      clearTimer();
    },
  };
}

export function createSessionClient(options: SessionClientOptions): SessionClient {
  let current: Snapshot = null;
  let realtime: Ably.Realtime | null = null;

  /**
   * The lifecycle latch — the bound that makes `state.ts`'s budget figures true rather than
   * aspirational. Rules and reasoning live on `advanceLifecycle`.
   *
   * **The accepted cost**, stated here because it is a real host workflow: a host who purges
   * and restarts mid-event (the case `index.astro`'s `ended` branch already contemplates)
   * leaves a *degraded* device latched — it stays on "To już koniec" until the attendee
   * reloads. A device with a working channel picks the new session up from the next snapshot
   * as usual. The alternative was unbounded spend after every session on every phone left
   * open, which happens at every event rather than at the rare restart.
   */
  let lifecycle: SessionLifecycle = INITIAL_LIFECYCLE;

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

    lifecycle = advanceLifecycle(lifecycle, state);

    options.onSnapshot(state, source);
    return true;
  };

  const refresh = async (): Promise<void> => {
    const response = await fetch("/api/quiz/state", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
   * Set by `close`, and checked before anything reaches the caller or the network.
   *
   * `Realtime.close()` drives the connection through `closing` and `closed`, both delivered
   * *asynchronously*. Detaching the listener is what stops them arriving, but this flag is
   * the belt to that braces: a closed client's last observable act must be the close itself,
   * not a "connection lost" it reports on the way out.
   */
  let closed = false;

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
    if (closed) return;
    const status: ConnectionStatus =
      degraded && transportStatus !== "connected" ? "degraded" : transportStatus;
    options.onConnection?.(status, transportInfo);
  };

  /**
   * The three moving facts that decide whether polling is worth doing, asked fresh on every
   * arm and answered by a predicate with its own tests — see `shouldFallbackPoll`.
   */
  const poll = createFallbackPoll({
    refresh: () => refresh(),
    shouldPoll: () =>
      shouldFallbackPoll({
        fallbackPolling: options.fallbackPolling,
        transportStatus,
        sessionOver: lifecycle.sessionOver,
      }),
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
    // Cancel on the way out, not just decline to re-arm: without this a tick already
    // scheduled fires against a backgrounded tab. `/quiz/host`'s participation loop cancels
    // for the same reason, and diverging from it here was an oversight rather than a choice.
    if (document.visibilityState === "hidden") poll.pause();
    else poll.arm();
  };

  /**
   * The page going away, and coming back.
   *
   * Same pair, and the same reasoning, as `/quiz/host`'s participation loop: a timer that
   * outlives the page is a request fired at a document that is gone, and a back-forward-cache
   * restore does not re-run the script, so something has to re-arm on the way in.
   *
   * `pause`, not `dispose` — a `pagehide` may be a bfcache suspension rather than a teardown,
   * and disposing would leave a restored page with a permanently dead loop and no symptom.
   * Not `stop` either: that drops the `degraded` status, so a restored page would flash the
   * red "connection lost" line for one interval before the first poll re-earned the banner.
   * The Ably connection is deliberately left alone: reopening one on `pageshow` is a bigger
   * mechanism than the leak it would fix.
   */
  const onPageHide = (): void => poll.pause();
  const onPageShow = (): void => poll.arm();

  /**
   * Registered together, removed together — see `close`.
   *
   * Targets match `/quiz/host`'s existing handlers: `visibilitychange` is dispatched at
   * `document` and only reaches `window` by bubbling, so it is registered where it is fired.
   */
  const lifecycleListeners: readonly [EventTarget, string, () => void][] = [
    [document, "visibilitychange", onVisibilityChange],
    [window, "pagehide", onPageHide],
    [window, "pageshow", onPageShow],
  ];

  /**
   * Held so `close` can detach it *before* `Realtime.close()` runs. Without the detach, the
   * `closing` and `closed` transitions Ably emits during teardown reach this handler, are
   * folded to `lost` like any other unhealthy state, and re-arm the loop that `close` just
   * cancelled.
   */
  const onConnectionChange = (change: Ably.ConnectionStateChange): void => {
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

    realtime.connection.on(onConnectionChange);

    if (options.fallbackPolling) {
      for (const [target, event, handler] of lifecycleListeners) {
        target.addEventListener(event, handler);
      }
    }

    const channel = realtime.channels.get(options.channelName);
    try {
      await channel.subscribe(options.snapshotEvent, (message) => {
        apply((message.data ?? null) as Snapshot, "realtime");
      });
    } catch (err) {
      /**
       * **A connected connection with a failed channel is the worst state this client can be
       * in, and until this catch existed it was also the quietest.** Everything about
       * transport health is derived from *connection* state, so an attach that fails leaves
       * `transportStatus` at `connected`: the fallback declines to arm, the host's line reads
       * a neutral grey `połączenie: connected`, and no snapshot ever arrives. A frozen screen
       * under a healthy label is strictly worse than the `lost` case this module exists to
       * make legible.
       *
       * So: force the status off `connected`, which both tells the views and lets the
       * fallback arm. `detail` gets a short transport word rather than the error text, which
       * is the most useful of the three things that field is documented to carry.
       *
       * **Not rethrown.** The failure is handled here — reported and mitigated — so a
       * `start()` that resolved anyway would be the honest description. Note this does not
       * cover a channel that fails *after* a successful attach; that needs channel-state
       * subscription, recorded as follow-up work in the review.
       */
      const code = (err as { code?: unknown } | null)?.code;
      const { info } = classifyConnection(
        "failed",
        typeof code === "number" ? code : undefined
      );
      transportStatus = "lost";
      transportInfo = { ...info, detail: "channel-failed" };
      poll.arm();
      report();
    }
  };

  return {
    current: () => current,
    apply,
    refresh,
    start,
    /**
     * **Order is the whole correctness of this function.**
     *
     * `closed` first, so nothing that follows can report a status to a caller that is
     * tearing down. Then detach the connection listener — *before* `Realtime.close()`, whose
     * `closing`/`closed` transitions would otherwise arrive at that handler, fold to `lost`
     * like any other unhealthy state, and re-arm the loop this function is here to stop.
     * Then `dispose` rather than `stop`, because a tick already in flight re-arms from its
     * own `finally` and only the terminal flag survives that.
     */
    close: () => {
      closed = true;
      realtime?.connection.off(onConnectionChange);
      realtime?.close();
      realtime = null;
      poll.dispose();
      for (const [target, event, handler] of lifecycleListeners) {
        target.removeEventListener(event, handler);
      }
    },
  };
}
