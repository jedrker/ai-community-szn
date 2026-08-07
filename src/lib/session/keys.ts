/**
 * Every name the LiveQuiz session owns (roadmap F-03).
 *
 * This module exists so that "all session data is somewhere the purge can reach" is a
 * property of the code rather than of everyone's memory. F-02 could keep the key name
 * as a lone constant in `store.ts` because there was exactly one. From S-02 there will
 * be players, from S-03 answers and scores — and a key that nobody registered survives
 * both the TTL re-arm and the purge, which is discovered after a real event or not at
 * all.
 *
 * **The rule: every `livequiz:`-prefixed name in this project is declared here.**
 * `keys.test.ts` fails the suite if one appears anywhere else. Adding a key means
 * adding a registry entry; there is no other sanctioned path.
 *
 * That test is a *textual* gate: it catches string literals, not names assembled at
 * runtime from variables. Do not read a green suite as proof that the store holds
 * nothing unregistered — `scripts/check-purge-residue.ts` scans the real store for
 * exactly the residue this cannot see. The two are complementary, and the honest
 * summary is that this one catches the likely mistake cheaply and often.
 *
 * ## Why the Ably channel lives here too, despite not being purgeable
 *
 * `SESSION_CHANNEL` is not a store key and no `DEL` will ever touch it. It is here
 * because the invariant worth enforcing is "one module owns every namespaced name" —
 * an invariant with an exemption list is one that rots, and the alternative was
 * exempting `realtime.ts` from the scan forever. It also happens to be true that both
 * surfaces share the `livequiz` namespace: the F-03 retention probe established that
 * Ably's namespace is the segment before the first colon, so the channel rule
 * governing retention keys off this same prefix.
 *
 * `zod` is not imported and neither is anything else — this module is a leaf so that
 * `store.ts` can import it without a cycle.
 */

/**
 * The one prefix. Everything below is built from it, so there is exactly one place
 * that spells it out — which is also what lets the enforcement test treat a bare
 * occurrence of this string anywhere else as an escape.
 */
export const SESSION_NAMESPACE = "livequiz:";

/**
 * A declared store key: its name, and what it holds.
 *
 * `holds` is not decoration. A future reader deciding whether a key is safe to purge
 * needs to know what is in it, and the answer should not require reading the slice
 * that wrote it.
 */
export type RegisteredKey = {
  readonly name: string;
  readonly holds: string;
};

/**
 * The purgeable set. `end` re-arms every entry to the short lifetime; `purge` deletes
 * every entry. Both operate on this list, so a key added here is automatically covered
 * by both and a key added anywhere else is covered by neither.
 *
 * S-02, S-03 and S-07 extend this array. They do not invent their own names.
 */
const REGISTERED_KEYS = [
  {
    name: `${SESSION_NAMESPACE}session`,
    holds:
      "The single session document: version, phase, currentQuestionId, startedAt, " +
      "updatedAt, playerCount. A count of players, never their names — display names " +
      "live in the two hashes below and are deliberately kept out of this document, " +
      "because it is the one that gets published to Ably on every host action.",
  },
  {
    name: `${SESSION_NAMESPACE}players`,
    holds:
      "ATTENDEE DATA. Hash of folded display name -> player record JSON " +
      "{ id, displayName, joinedAt }. The folded name is the uniqueness key (FR-008); " +
      "displayName is what the attendee actually typed and what a leaderboard shows. " +
      "HLEN of this hash is the join count.",
  },
  {
    name: `${SESSION_NAMESPACE}player-ids`,
    holds:
      "ATTENDEE DATA. Hash of opaque player id -> folded display name. The reverse " +
      "index: it is how a device that reloads is recognised from the id it stored, " +
      "without which a returning attendee would be rejected by their own name claim.",
  },
] as const satisfies readonly RegisteredKey[];

/**
 * The session document's key.
 *
 * Re-exported by `store.ts` under the same name it has had since F-02, so no existing
 * importer changes.
 */
export const SESSION_KEY = REGISTERED_KEYS[0].name;

/**
 * The players hash: folded display name -> player record.
 *
 * Attendee data, and the first of it this project has ever held. It is in the registry
 * — so `end` shortens it and `purge` deletes it — which is the whole mechanism behind
 * the PRD's retention guardrail.
 */
export const PLAYERS_KEY = REGISTERED_KEYS[1].name;

/**
 * The reverse index: opaque player id -> folded display name.
 *
 * Two keys rather than one because the two lookups go in opposite directions and both
 * are needed. Claiming asks "is this name taken?", which wants the name as the field;
 * a reloading device asks "who am I?", which wants the id as the field. A single hash
 * would make one of those a scan over every player.
 */
export const PLAYER_IDS_KEY = REGISTERED_KEYS[2].name;

/**
 * The Ably channel every snapshot is published to.
 *
 * Not a store key — see the module docstring for why it is declared here anyway.
 */
export const SESSION_CHANNEL = `${SESSION_NAMESPACE}session`;

/**
 * The `localStorage` entry an attendee's own device holds: `{ id, displayName }`.
 *
 * **Not a store key, and no `purge` will ever reach it** — it lives in a browser this
 * project does not control. That is compliant rather than a gap: the PRD's retention
 * guardrail is about *operator-accessible* storage, and a phone in someone's pocket is
 * not that. Stated here rather than left to be discovered, because "attendee data that
 * survives the purge" is exactly the sentence that should stop a reader.
 *
 * Declared in this module for the same reason `SESSION_CHANNEL` is: the invariant is
 * "one module owns every namespaced name", and an invariant with an exemption list is
 * one that rots.
 */
export const PLAYER_STORAGE_KEY = `${SESSION_NAMESPACE}player`;

/**
 * Every registered key name, in declaration order.
 *
 * This is the list the end and purge scripts pass as Redis `KEYS`. Returned as a fresh
 * array rather than the frozen source so a caller cannot mutate the registry by
 * accident.
 */
export function registeredKeys(): string[] {
  return REGISTERED_KEYS.map((key) => key.name);
}
