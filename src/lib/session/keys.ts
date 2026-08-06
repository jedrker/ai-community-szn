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
      "updatedAt. Players, answers and scores join it or sit beside it from S-02.",
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
 * The Ably channel every snapshot is published to.
 *
 * Not a store key — see the module docstring for why it is declared here anyway.
 */
export const SESSION_CHANNEL = `${SESSION_NAMESPACE}session`;

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
