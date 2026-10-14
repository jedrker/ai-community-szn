import type { Quiz } from "../schema";

/**
 * A one-question audience vote, run after the evening's AI-setup demos: attendees pick
 * the setup they liked best and the winner takes the prize. Authored as source and
 * registered in `./index.ts` like every other quiz — see `summer-tour-szczecin.ts` for
 * what the identity fields mean.
 *
 * **Unscored and untimed.** A vote has no correct answer, so there is nothing to award
 * points for, and the schema refuses `points` on it. Without points there is no clock
 * either: the schema refuses `timeLimitSeconds` on an unscored question, so the host
 * decides when voting is over — the panel's reveal verb, named "zamknij głosowanie" for
 * this kind, closes it and shows the result.
 *
 * **These four are the defaults.** The host renames, adds and removes candidates in the
 * lobby from the panel menu, and the session's `candidates` field
 * (`src/lib/session/state.ts`) overrides this list for that session — nothing here
 * changes between evenings. A vote's options are never shuffled (`public.ts`), so
 * whatever list is in force appears in the order it was written.
 */
export const glosowanieAiSetup = {
  id: "glosowanie-ai-setup",
  title: "Głosowanie: najlepszy AI setup",
  code: "4242",
  questions: [
    {
      kind: "vote",
      id: "najlepszy-ai-setup",
      prompt: "Który AI setup był najlepszy?",
      points: null,
      options: [
        { id: "demo-1", text: "Demo 1" },
        { id: "demo-2", text: "Demo 2" },
        { id: "demo-3", text: "Demo 3" },
        { id: "demo-4", text: "Demo 4" },
      ],
    },
  ],
} satisfies Quiz;
