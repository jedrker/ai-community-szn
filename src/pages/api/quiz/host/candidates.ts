import type { APIRoute } from "astro";

import {
  candidateListSchema,
  type CandidateList,
} from "../../../../lib/session/candidates";
import {
  applyHostAction,
  authorizeHost,
  extractCandidatesFields,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { logSessionEvent } from "../../../../lib/session/log";
import { writeSession } from "../../../../lib/session/store";
import { getQuizById } from "../../../../quiz/index";

/**
 * Sets a vote question's candidate list for this session (host-editable vote
 * candidates). The list replaces the definition's options for that question until the
 * session ends; a new `start` begins from the committed defaults again.
 *
 * **Lobby only.** Once the vote opens the list is frozen: every tally is keyed by a
 * candidate id, so a removal after the first vote would orphan a count and a re-added
 * id would inherit one. The panel disables the editor outside the lobby; this refusal
 * is the backstop.
 *
 * The host's `version` is passed through as the write's expected version, so a list
 * edited against a snapshot the session has since moved past comes back as
 * `applied: false` rather than being committed over a state the host never saw.
 */
export const POST: APIRoute = async ({ request }) => {
  const { secret, version, questionId, candidates } =
    await extractCandidatesFields(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  if (version === null) {
    return toResponse({ status: 400, body: { error: "Brak wersji sesji." } });
  }
  if (questionId === null) {
    return toResponse({
      status: 400,
      body: { error: "Brak identyfikatora pytania." },
    });
  }

  let raw: unknown;
  try {
    raw = candidates === null ? undefined : JSON.parse(candidates);
  } catch {
    raw = undefined;
  }
  if (raw === undefined) {
    return toResponse({
      status: 400,
      body: { error: "Nieprawidłowa lista uczestników." },
    });
  }
  const parsed = candidateListSchema.safeParse(raw);
  if (!parsed.success) {
    return toResponse({
      status: 400,
      body: {
        error:
          parsed.error.issues[0]?.message ?? "Nieprawidłowa lista uczestników.",
      },
    });
  }
  const list: CandidateList = parsed.data;

  // Set by the transition when it declines; read after it to turn the no-op into a 409
  // with the reason, the same carrier `reveal.ts` uses.
  let refusal: string | null = null;

  const outcome = await applyHostAction(
    (current, now) => {
      if (current.phase !== "lobby") {
        refusal =
          "Listę uczestników można zmienić tylko w lobby, przed otwarciem głosowania.";
        return null;
      }
      const question = getQuizById(current.quizId)?.questions.find(
        (candidate) => candidate.id === questionId,
      );
      if (question?.kind !== "vote") {
        refusal = "To pytanie nie jest głosowaniem w tej sesji.";
        return null;
      }
      // A spread is safe here, unlike the other constructors: in `lobby` the schema
      // already forces every transition field to null, so there is nothing to clear.
      return {
        ...current,
        version: current.version + 1,
        updatedAt: now,
        candidates: { ...current.candidates, [questionId]: list },
      };
    },
    Date.now(),
    writeSession,
    version,
  );

  if (refusal !== null) {
    return toResponse({ status: 409, body: { error: refusal } });
  }

  if (
    outcome.status === 200 &&
    "applied" in outcome.body &&
    outcome.body.applied === true
  ) {
    logSessionEvent("session.candidates.set", {
      version: outcome.body.state.version,
      questionId,
      candidateCount: list.length,
    });
  }

  return toResponse(outcome);
};
