import type { APIRoute } from "astro";

import {
  authorizeHost,
  extractStartFields,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { publishSnapshot } from "../../../../lib/session/realtime";
import { createSession } from "../../../../lib/session/store";
import { getQuizById } from "../../../../quiz/index";

/**
 * Starts the session.
 *
 * **It opens the lobby, not the first question.** PRD FR-002 keeps an explicit
 * start precisely because "the deliberate start is what lets the host gather the
 * room before the first question", and the drafted quiz's opening two questions
 * — a word cloud and "Czy wszyscy są gotowi?" — are written for that beat. The
 * first `advance` opens question 1.
 *
 * Idempotent, and not by a check-then-write here: `createSession` is a
 * create-if-absent Lua script, so two host devices racing — or one host
 * double-tapping — cannot reset a session that is already running.
 *
 * **It also names the quiz** (multiple-quizzes). Idempotence now has a condition: the
 * same quiz twice is the harmless replay it always was, and a *different* quiz is a
 * visible 409 rather than a 200 that looks like success. That distinction is the whole
 * reason this route reads a body at all — see `extractStartFields`.
 */
export const POST: APIRoute = async ({ request }) => {
  const { secret, quizId } = await extractStartFields(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  /**
   * Refused, never defaulted — an absent field and an unknown slug get the same answer
   * because they mean the same thing here: nothing said which quiz to run. Picking one
   * would be this route deciding what the host meant, and the cost of guessing wrong is
   * a room answering the wrong questions.
   *
   * 400 rather than 409: the session is not in a bad state, the request is.
   */
  const requested = quizId === null ? undefined : getQuizById(quizId);
  if (requested === undefined) {
    return toResponse({
      status: 400,
      body: {
        error:
          "Nie wiadomo, który quiz uruchomić — otwórz panel hosta wybranego quizu i spróbuj ponownie.",
      },
    });
  }

  const result = await createSession(Date.now(), requested.id);

  if (result.outcome === "unconfigured") {
    return toResponse({
      status: 503,
      body: {
        error: "Sesja nie jest skonfigurowana. Sprawdź zmienne środowiskowe.",
      },
    });
  }

  if (result.outcome === "invalid") {
    console.error(
      "Session document invalid on start:",
      result.problems.join("; "),
    );
    return toResponse({
      status: 409,
      body: {
        error: "Stan sesji jest nieprawidłowy. Sprawdź definicję quizu.",
      },
    });
  }

  if (result.outcome === "failed") {
    console.error("Session start failed:", result.reason);
    return toResponse({
      status: 503,
      body: { error: "Nie udało się rozpocząć sesji. Spróbuj ponownie." },
    });
  }

  /**
   * "You asked for quiz B while quiz A is running" — refused, and visibly.
   *
   * Before the publish, deliberately: this is not a re-broadcast the host asked for, it
   * is a request that is not going to happen, and echoing the running session to every
   * device would be the wrong answer to it.
   *
   * The comparison costs nothing extra — `CREATE_IF_ABSENT`'s `exists` branch already
   * returns the full running document, so there is no second read and no change to the
   * Lua script.
   *
   * It names the running quiz's **title**, not its slug: the host is looking at a panel
   * and needs to recognise which session is in the way. A session started before quiz
   * identity existed has no title to name, so it says so rather than printing a
   * sentinel — same refusal, honest reason.
   */
  if (result.outcome === "exists" && result.state.quizId !== requested.id) {
    const running = getQuizById(result.state.quizId);
    const runningName =
      running === undefined
        ? "sesja rozpoczęta przed wprowadzeniem identyfikatorów quizów"
        : `„${running.title}”`;

    return toResponse({
      status: 409,
      body: {
        state: result.state,
        applied: false,
        error:
          `Trwa już inna sesja (${runningName}) — zakończ ją i uruchom \`bun run quiz:reset\`, ` +
          `zanim uruchomisz quiz „${requested.title}”.`,
      },
    });
  }

  // Publish in both cases. On `exists` this is a re-broadcast of the current
  // state, which is exactly what a host wants after a device reconnects — and it
  // is harmless, because clients drop anything not newer than what they hold.
  const published = await publishSnapshot(result.state);

  if (published.outcome !== "ok") {
    return toResponse({
      status: 502,
      body: {
        state: result.state,
        applied: true,
        error:
          "Sesja istnieje, ale stan nie dotarł do urządzeń. Powtórz akcję, aby rozgłosić go ponownie.",
      },
    });
  }

  // Branch the whole outcome, not just `body` — a ternary inside the object
  // widens `body` into a union the discriminated type will not narrow.
  if (result.outcome === "created") {
    return toResponse({
      status: 200,
      body: { state: result.state, applied: true },
    });
  }

  return toResponse({
    status: 200,
    body: { state: result.state, applied: false, note: "already-started" },
  });
};
