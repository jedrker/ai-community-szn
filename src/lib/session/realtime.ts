import { Rest } from "ably";

import { SESSION_CHANNEL } from "./keys";
import { logSessionEvent } from "./log";
import type { SessionState } from "./state";

/**
 * The realtime transport (roadmap F-02).
 *
 * Ably carries messages; it is not the source of truth. Authoritative state
 * lives in `store.ts` — `infrastructure.md` §Getting Started step 4 is explicit
 * that keeping scores in the transport is the mistake to avoid.
 *
 * Two things this module deliberately does not do:
 *
 * - **No presence.** `infrastructure.md` measured the join storm at O(N²):
 *   150 attendees entering one presence set is ~22.5k messages. Standings are
 *   broadcast from authoritative state instead (and that is S-07's job, not
 *   this slice's).
 * - **No Realtime client.** `Rest` only. A serverless function must not open a
 *   persistent connection — that is precisely why an external provider carries
 *   the sockets rather than the platform.
 */

/**
 * The one channel.
 *
 * PRD §Non-Goals settles that there is one session, one quiz, one room, so a
 * per-session channel name would be ceremony around a constant.
 *
 * Declared in `keys.ts` and re-exported here, so every importer since F-02 keeps
 * working. It sits in the registry despite not being a purgeable store key
 * because the invariant `keys.test.ts` enforces is "one module owns every
 * namespaced name" — an invariant with an exemption list is one that rots. It is
 * also genuinely namespaced: Ably's namespace is the segment before the first
 * colon, so the retention rule measured in F-03's probe keys off this prefix.
 */
export { SESSION_CHANNEL };

/** The message name every snapshot is published under. */
export const SNAPSHOT_EVENT = "snapshot";

export type TokenResult =
  | { outcome: "ok"; tokenRequest: unknown }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

export type PublishResult =
  | { outcome: "ok" }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

const UNCONFIGURED_REASON = "ABLY_API_KEY must be set to run a session";

/**
 * `ABLY_API_KEY` is read here and nowhere else in the codebase — the browser
 * never receives it. Empty strings count as absent for the same reason as in
 * `store.ts`: Vercel's store and a pulled `.env` can both produce one.
 */
function apiKey(): string | undefined {
  const value = import.meta.env.ABLY_API_KEY;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function client(): Rest | null {
  const key = apiKey();
  if (!key) return null;
  return new Rest({ key });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Mints a short-lived token request for a browser.
 *
 * **`subscribe` only, and that is load-bearing.** A client holding this token
 * cannot publish, so it cannot forge a state snapshot even with a valid token
 * and even though the endpoint that mints it is deliberately open. The host's
 * write path is guarded separately, by the shared secret on the host routes.
 *
 * Returns the token *request*, not a token: the browser exchanges it with Ably
 * itself, so this project never handles the token either.
 */
export async function createTokenRequest(): Promise<TokenResult> {
  const rest = client();
  if (!rest) {
    logSessionEvent("session.unconfigured", { reason: UNCONFIGURED_REASON });
    return { outcome: "unconfigured", reason: UNCONFIGURED_REASON };
  }

  try {
    const tokenRequest = await rest.auth.createTokenRequest({
      capability: { [SESSION_CHANNEL]: ["subscribe"] },
    });
    return { outcome: "ok", tokenRequest };
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }
}

/**
 * Publishes the whole state, every time.
 *
 * Snapshot-per-publish rather than deltas: a device that missed a message is
 * correct again on the next one, and a reconnecting device needs no replay.
 * That is what structurally removes the PRD's "no divergence in standings
 * between devices" failure mode — with deltas, one dropped message leaves a
 * device permanently wrong.
 *
 * Republishing the same snapshot is harmless, because clients drop anything not
 * newer than the version they already hold. So a caller whose publish failed
 * after the store write was accepted may safely retry.
 */
export async function publishSnapshot(state: SessionState): Promise<PublishResult> {
  const rest = client();
  if (!rest) {
    logSessionEvent("session.unconfigured", { reason: UNCONFIGURED_REASON });
    return { outcome: "unconfigured", reason: UNCONFIGURED_REASON };
  }

  try {
    await rest.channels.get(SESSION_CHANNEL).publish(SNAPSHOT_EVENT, state);
    logSessionEvent("session.publish.ok", {
      version: state.version,
      phase: state.phase,
    });
    return { outcome: "ok" };
  } catch (err) {
    const reason = describe(err);
    logSessionEvent("session.publish.failed", { version: state.version, reason });
    return { outcome: "failed", reason };
  }
}
