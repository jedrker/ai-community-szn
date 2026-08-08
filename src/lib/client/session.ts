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

export type SessionClientOptions = {
  /** From `define:vars`, never imported — see the module docstring. */
  readonly channelName: string;
  readonly snapshotEvent: string;
  /** Called for every snapshot that wins the version check, and only those. */
  readonly onSnapshot: (state: Snapshot, source: SnapshotSource) => void;
  readonly onConnection?: (status: ConnectionStatus, detail: string) => void;
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
 * Ably's connection states, folded into the three a view can render.
 *
 * `initialized` and `connecting` are the opening moments; `connected` is the only
 * healthy one; everything else — `disconnected`, `suspended`, `closing`, `closed`,
 * `failed` — is a device that is not receiving snapshots, which from the attendee's
 * side is one situation with one message.
 */
function toStatus(state: string): ConnectionStatus {
  if (state === "connected") return "connected";
  if (state === "initialized" || state === "connecting") return "connecting";
  return "lost";
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
      options.onConnection?.("connecting", describe(err));
    }

    // authUrl, never a key: the browser exchanges a short-lived subscribe-only token
    // request with Ably itself, so no credential of this project's ever reaches it.
    realtime = new Ably.Realtime({ authUrl: "/api/quiz/token" });

    realtime.connection.on((change) => {
      options.onConnection?.(toStatus(change.current), change.current);
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
