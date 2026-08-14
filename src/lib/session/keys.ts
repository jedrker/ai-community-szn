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
  {
    name: `${SESSION_NAMESPACE}answers`,
    holds:
      "ATTENDEE DATA. Hash of `<questionId>:<playerId>` -> answer record JSON " +
      "{ playerId, questionId, optionIds, text, value, word, elapsedMs, correct, " +
      "awarded, answeredAt }. What a given person answered, which is the most sensitive " +
      "thing this project stores — `text` is attendee-authored free text (a typed " +
      "answer, or a word-cloud word) and `word` is its folded form. No display name: " +
      "the players hash owns that mapping, and a second copy is a second thing the " +
      "purge has to reach.",
  },
  {
    name: `${SESSION_NAMESPACE}scores`,
    holds:
      "ATTENDEE DATA. Hash of opaque player id -> running total (an integer). " +
      "Pseudonymous on its own, but joinable against the players hash, so it is " +
      "attendee data by the same reasoning the reverse index is.",
  },
  {
    name: `${SESSION_NAMESPACE}tallies`,
    holds:
      "Hash of aggregate counters, in three field families: " +
      "`answered:<questionId>` -> how many people answered, " +
      "`opt:<questionId>:<optionId>` -> how many chose that option, and " +
      "`word:<questionId>:<foldedWord>` -> how many wrote that word (S-08). " +
      "This entry used to open 'NOT attendee data — the first registered key that is " +
      "not', and S-08 made that too strong to leave standing: the word family's FIELD " +
      "NAMES are attendee-authored text, folded only for case. The claim is corrected " +
      "here rather than deleted, because a reader checking the retention guardrail " +
      "should meet the reversal where the old sentence was. What still holds is the " +
      "part that matters: no field is keyed by a player id or a display name, so " +
      "nothing here says WHO wrote or chose anything, and counts over a 150-person " +
      "room identify nobody. What has changed is that this key is no longer merely " +
      "counters, so it is purged because it holds attendee content and not only " +
      "because the registry has no exemption list. That second reason stands too: an " +
      "invariant with an exemption list is an invariant that rots. Note also that the " +
      "word family is the only one whose field count grows with the ROOM rather than " +
      "with the quiz — up to one field per attendee.",
  },
  {
    name: `${SESSION_NAMESPACE}devices`,
    holds:
      "Hash of opaque device id -> how many players that device has claimed (an " +
      "integer). NOT attendee data: the id is minted by the browser about itself and " +
      "is stored beside no name, no player id and no answer, so nothing here says WHO " +
      "played or what they played as — it is the weakest thing that can enforce the " +
      "per-device cap (FR-018). It is registered anyway, and for two reasons worth " +
      "keeping apart: the registry has no exemption list, and a device id left behind " +
      "after a session would still be a stable handle on a returning phone. The count " +
      "only ever goes up — there is no 'abandon a player' action to release a slot " +
      "against — so a claim refused as taken must not reach it.",
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
 * The answers hash: `<questionId>:<playerId>` -> answer record.
 *
 * One hash for the whole session rather than one key per question. A per-question
 * name would have to be assembled at runtime, and a runtime-assembled name is exactly
 * what this registry cannot see — reached by neither `end` nor `purge`, and invisible
 * to `keys.test.ts`, which scans for literals. The compound field carries the same
 * information at no cost. `answerField` in `answers.ts` owns the format.
 */
export const ANSWERS_KEY = REGISTERED_KEYS[3].name;

/**
 * The scores hash: opaque player id -> running total.
 *
 * Keyed by id rather than by folded name, unlike the players hash: the totals are
 * read back by the device that owns them, and a device knows its id. S-07's
 * leaderboard is the slice that needs the join back to a name, and it is also the
 * slice that has to decide what putting 150 names on a screen means.
 */
export const SCORES_KEY = REGISTERED_KEYS[4].name;

/**
 * The tallies hash: aggregate counters, one per question, one per option, and one per
 * word.
 *
 * The three field families are `answered:<questionId>`, `opt:<questionId>:<optionId>`
 * and `word:<questionId>:<foldedWord>`, and `tallies.ts` owns all three formats — the
 * role `answerField` plays for the answers hash, and for the same reason: a read path
 * and a write path that spell a field differently present as "nobody answered".
 *
 * One hash for the whole session rather than one per question, for the reason
 * `ANSWERS_KEY` documents: a per-question name would have to be assembled at runtime,
 * and a runtime-assembled name is reached by neither `end` nor `purge`.
 *
 * Counted at submission rather than derived at read time. The answers hash reaches
 * ~1,500 fields by the last question, so deriving a count would trade a bounded
 * per-submission cost for an unbounded per-read one — on the one read this slice
 * intends to poll.
 */
export const TALLIES_KEY = REGISTERED_KEYS[5].name;

/**
 * The devices hash: opaque device id -> how many players it has claimed (roadmap S-09).
 *
 * Read and written inside `CLAIM_PLAYER` and nowhere else. The check has to be in the
 * script for the same reason the collision check is: a count read outside it is a count
 * that can change before the write lands, and two fast taps are the ordinary thing to do
 * on a phone.
 *
 * **The counter is cumulative and never decremented.** FR-018 is about *registering* an
 * unreasonable number of players, and a slot that could be released would let one device
 * cycle a single slot indefinitely — which is the whole guard, defeated by a mechanism
 * built to be forgiving. The accepted cost is that an attendee who claims a name they
 * immediately regret has spent one of three.
 */
export const DEVICES_KEY = REGISTERED_KEYS[6].name;

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
 * The `localStorage` entry holding when this device first *saw* each question:
 * `{ [questionId]: epochMs }`.
 *
 * Same posture as `PLAYER_STORAGE_KEY` above — not a store key, no purge reaches it,
 * and that is compliant rather than a gap. It holds no answer and no name, only the
 * timestamps of a device's own paints.
 *
 * **It exists because a reload otherwise resets the clock.** FR-019 measures the
 * speed component from when the question became visible on that device; a value held
 * only in memory is regenerated on reload, which would hand full speed weight to
 * anyone who reloaded mid-question. Reloads during a 15-minute segment are near
 * certain, so the timestamp is persisted and read back rather than overwritten.
 */
export const QUESTION_SEEN_STORAGE_KEY = `${SESSION_NAMESPACE}seen`;

/**
 * The `localStorage` entry holding this device's own opaque id: a bare string
 * (roadmap S-09, FR-018).
 *
 * Third of the browser-storage keys and the same posture as the two above — no purge
 * reaches it, and that is compliant rather than a gap, because the retention guardrail
 * is about operator-accessible storage.
 *
 * **It is the one that carries no session data at all.** The other two hold a display
 * name and a set of paint times; this holds a number the device made up about itself,
 * whose only meaning is as a field name in `DEVICES_KEY`. That is deliberate: the cap
 * needs to recognise a device across joins without the project learning anything else
 * about it.
 *
 * **It is deliberately not cleared when a stale player is dropped.** `clearPlayer` and
 * `clearSeen` run when a stored id no longer resolves, because that data belonged to a
 * session that is gone. This one belongs to the *device*, and clearing it on that path
 * would hand a fresh cap allowance to anyone who reloads after a purge.
 */
export const DEVICE_STORAGE_KEY = `${SESSION_NAMESPACE}device`;

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
