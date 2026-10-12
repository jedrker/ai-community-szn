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
 * **Options keep definition order.** The projection shuffles choice options only to hide
 * the correct one; a vote has none, so the candidates appear in the order written here.
 * List them in the order the demos run, so the screen matches what the room just saw.
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
        { id: "demo-5", text: "Demo 5" },
        { id: "demo-6", text: "Demo 6" },
      ],
    },
  ],
} satisfies Quiz;
