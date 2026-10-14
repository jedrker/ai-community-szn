import { z } from "zod";
import { normalizePolish } from "../../quiz/normalize";
import { QUESTION_ID, findDuplicates } from "../../quiz/schema";
import type { SessionState } from "./state";

/**
 * A vote's candidate list, as the host sets it in the lobby (`POST
 * /api/quiz/host/candidates`). It overrides the committed options for that session
 * only — the definition keeps the defaults, the session document carries the room's
 * list in `candidates` (`state.ts`), and `candidatesFor` is how every reader picks
 * between the two.
 *
 * The bounds are about the projector: twelve bands still fit the 1080 artboard, and a
 * name longer than forty characters does not read from the back of the room. Messages
 * are Polish because the route forwards the first failing issue to the host's toast.
 */
export const MIN_CANDIDATES = 2;
export const MAX_CANDIDATES = 12;
export const MAX_CANDIDATE_TEXT_LENGTH = 40;

const LIST_SIZE_MESSAGE = `Lista musi mieć od ${MIN_CANDIDATES} do ${MAX_CANDIDATES} uczestników.`;

export const candidateListSchema = z
  .array(
    z.object({
      id: z
        .string()
        .regex(QUESTION_ID, "Nieprawidłowy identyfikator uczestnika."),
      text: z
        .string()
        .trim()
        .min(1, "Nazwa uczestnika nie może być pusta.")
        .max(
          MAX_CANDIDATE_TEXT_LENGTH,
          `Nazwa uczestnika ma najwyżej ${MAX_CANDIDATE_TEXT_LENGTH} znaków.`,
        ),
    }),
  )
  .min(MIN_CANDIDATES, LIST_SIZE_MESSAGE)
  .max(MAX_CANDIDATES, LIST_SIZE_MESSAGE)
  .superRefine((list, ctx) => {
    if (findDuplicates(list.map((candidate) => candidate.id)).length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Dwa wiersze mają ten sam identyfikator.",
      });
    }
    if (
      findDuplicates(list.map((candidate) => normalizePolish(candidate.text)))
        .length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Dwóch uczestników ma tę samą nazwę.",
      });
    }
  });

export type CandidateList = z.infer<typeof candidateListSchema>;
export type Candidate = CandidateList[number];

/** The list the room votes on: the session's, else the committed options. */
export function candidatesFor(
  state: Pick<SessionState, "candidates">,
  question: { readonly id: string; readonly options: readonly Candidate[] },
): readonly Candidate[] {
  return state.candidates[question.id] ?? question.options;
}
