import { jesiennyMeetupAi } from "./jesienny-meetup-ai";
import { summerTourSzczecin } from "./summer-tour-szczecin";

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
 * so this array is where a host's list gets rearranged — not in the page.
 *
 * Adding a quiz is two lines: a new file beside this one, and an entry below. The types
 * are deliberately not annotated here; each definition closes itself with
 * `satisfies Quiz`, so an authoring mistake is a red squiggle in the editor rather than
 * a runtime surprise (see `../CLAUDE.md`).
 */
export const quizDefinitions = [summerTourSzczecin, jesiennyMeetupAi];
