import { jesiennyMeetupAi } from "./jesienny-meetup-ai";
import { summerTourSzczecin } from "./summer-tour-szczecin";
import { unaited } from "./unaited";

/**
 * The registry: every committed quiz, unparsed.
 *
 * **This is the only module that imports a definition file**, and nothing outside
 * `src/quiz/` imports this one. Consumers go through `src/quiz/index.ts`, which parses
 * each entry against `quizSchema` and then applies the cross-quiz rules a single
 * definition cannot see — a duplicate slug, a duplicate join code, or the same question
 * id in two quizzes.
 *
 * **Order is the picker's order.** `/quiz/host` lists the quizzes as they appear here,
 * so this array is where a host's list gets rearranged — not in the page. It is an
 * editorial choice rather than a chronology: whatever is being run next goes first, and
 * moving an entry is the whole of how a host reorders that list.
 *
 * Position 0 has one incidental reader worth knowing about: `fixtureQuiz()` in
 * `../test-support.ts` and the `/quiz/spine-check` harness both take `quizzes[0]`, so the
 * quiz at the front is the one most session and route fixtures run against. Nothing
 * asserts *which* quiz that is — but the first entry must keep at least two questions,
 * one of them a word cloud and one a choice question, or fixtures that look those up by
 * kind have nothing to find.
 *
 * Adding a quiz is two lines: a new file beside this one, and an entry below. The types
 * are deliberately not annotated here; each definition closes itself with
 * `satisfies Quiz`, so an authoring mistake is a red squiggle in the editor rather than
 * a runtime surprise (see `../CLAUDE.md`).
 */
export const quizDefinitions = [unaited, summerTourSzczecin, jesiennyMeetupAi];
