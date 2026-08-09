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
export type ConnectionStatus = "connecting" | "connected" | "lost";

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
      options.onConnection?.(status, info);
    });

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
    },
  };
}
