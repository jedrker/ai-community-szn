/**
 * The host panel's candidate editor, as pure logic (host-editable vote candidates).
 *
 * Same shape as `controls.ts`: the rules live here where a test can run them, the DOM
 * writes stay on the page. Both quiz views overlay the session's list onto the public
 * question through `withCandidates`, so the phone and the projector read one source.
 *
 * Duplicate names are deliberately **not** checked here. The route refuses them under
 * its own Polish fold and the toast shows that message; a second validator folding
 * Polish differently would be the disagreement to avoid.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/` (`boundary.test.ts`);
 * `PublicOption`, `PublicQuestion` and `SessionState` arrive as `import type`.
 */

import type { PublicOption, PublicQuestion } from "../../quiz/public";
import type { SessionState } from "../session/state";

export type Candidate = PublicOption;

/** The server's bounds, handed down by frontmatter so this module never imports them. */
export type CandidateLimits = {
  readonly min: number;
  readonly max: number;
  readonly textLength: number;
};

const DEMO_ID = /^demo-(\d+)$/;

/** The list may change only before the vote opens; a tally keyed by a removed id is orphaned. */
export function candidatesEditable(state: SessionState | null): boolean {
  return state?.phase === "lobby";
}

/** The question with the session's list in place of its options, or the same object when the session set none. */
export function withCandidates<Q extends PublicQuestion | undefined>(
  question: Q,
  state: SessionState | null,
): Q {
  if (question === undefined || state === null) return question;
  const list = state.candidates[question.id];
  if (list === undefined) return question;
  return { ...question, options: list } as Q;
}

/** The next unused `demo-N`: one past the highest `N` already in the list, `demo-1` on an empty one. */
export function nextCandidate(list: readonly Candidate[]): Candidate {
  let highest = 0;
  for (const candidate of list) {
    const match = DEMO_ID.exec(candidate.id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  const k = highest + 1;
  return { id: `demo-${k}`, text: `Demo ${k}` };
}

/** Returns `list` itself when it is already at `limits.max`. */
export function addCandidate(
  list: readonly Candidate[],
  limits: CandidateLimits,
): Candidate[] {
  if (list.length >= limits.max) return list as Candidate[];
  return [...list, nextCandidate(list)];
}

/** Returns `list` itself when it is at `limits.min` or `id` is not in it. */
export function removeCandidate(
  list: readonly Candidate[],
  id: string,
  limits: CandidateLimits,
): Candidate[] {
  if (list.length <= limits.min) return list as Candidate[];
  if (!list.some((candidate) => candidate.id === id))
    return list as Candidate[];
  return list.filter((candidate) => candidate.id !== id);
}

export function renameCandidate(
  list: readonly Candidate[],
  id: string,
  text: string,
): Candidate[] {
  return list.map((candidate) =>
    candidate.id === id ? { id, text } : candidate,
  );
}

/** Clamps `count` to the limits, grows with `nextCandidate` and shrinks from the end. */
export function resizeCandidates(
  list: readonly Candidate[],
  count: number,
  limits: CandidateLimits,
): Candidate[] {
  const target = Math.min(
    limits.max,
    Math.max(limits.min, Number.isFinite(count) ? Math.trunc(count) : 0),
  );
  let next = [...list];
  while (next.length < target) next.push(nextCandidate(next));
  if (next.length > target) next = next.slice(0, target);
  return next;
}

/** The first thing wrong with the list as the server would see it, or `null` when it would accept it. */
export function candidateListProblem(
  list: readonly Candidate[],
  limits: CandidateLimits,
): string | null {
  for (const candidate of list) {
    const text = candidate.text.trim();
    if (text.length === 0) return "Nazwa uczestnika nie może być pusta.";
    if (text.length > limits.textLength) {
      return `Nazwa uczestnika ma najwyżej ${limits.textLength} znaków.`;
    }
  }
  if (list.length < limits.min || list.length > limits.max) {
    return `Lista musi mieć od ${limits.min} do ${limits.max} uczestników.`;
  }
  return null;
}
