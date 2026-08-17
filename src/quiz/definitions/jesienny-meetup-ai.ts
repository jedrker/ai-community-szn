import type { Quiz } from "../schema";

/**
 * A second quiz — the one that makes the registry a registry (impl-review F10).
 *
 * **Drafted, and meant to be edited.** The multiple-quizzes change delivered the machinery
 * for several quizzes and shipped one, which left the picker listing a single item and three
 * of the plan's own manual test steps unperformable: a wrong-quiz mismatch, `start`'s 409 on
 * a different quiz, and running one quiz after another all need a second quiz to exist.
 * Committing this one turns those from "verified once against a temporary fixture" into live
 * coverage that stays.
 *
 * So the questions below are a **starting point for the next event, not a finished set** —
 * swap them for whatever that evening needs. What must survive an edit is the shape the gate
 * and the tests rely on:
 *
 * - the **opener scores nothing** (FR-018 — the room is still arriving);
 * - every scored question carries `timeLimitSeconds`, and an unscored one may not;
 * - question ids are unique **across the whole registry**, not just this file;
 * - no id gives away its own answer (`definition.test.ts` checks this, and it is why the
 *   token question is `jednostka-tekstu` rather than anything containing "token");
 * - `id`, `title` and `code` are unique across the registry, and `id` is not a slug a static
 *   route already owns (see `RESERVED_QUIZ_SLUGS`).
 *
 * All of that is refused at the build gate, so an edit that breaks it fails `bun run build`
 * rather than surfacing on stage.
 */

const POINTS = 1000;

/** Long enough to read four options and tap one, on a phone, in a dark room. */
const TAP_SECONDS = 25;

/** Long enough to type an answer, including a correction. */
const TYPE_SECONDS = 30;

export const jesiennyMeetupAi = {
  id: "jesienny-meetup-ai",
  title: "Jesienny meetup: AI w praktyce",
  code: "2002",
  questions: [
    // Q1 — opens the segment. Unscored: watching your own word land on the big screen
    // is what proves the session is live (FR-012, FR-015).
    {
      kind: "word-cloud",
      id: "czego-oczekujesz-od-ai",
      prompt: "Napisz jednym słowem, czego oczekujesz od AI w pracy",
      points: null,
    },

    // Q2 — the gather beat. Every answer is "right", so it is unscored rather than
    // carrying correct ids (FR-010 resolves this via FR-017).
    {
      kind: "multiple-choice",
      id: "czy-widac-ekran",
      prompt: "Widzisz ekran i słyszysz prowadzącego?",
      points: null,
      options: [
        { id: "tak", text: "Tak, wszystko działa" },
        { id: "ekran", text: "Ekran tak, dźwięk słabo" },
        { id: "dzwiek", text: "Dźwięk tak, ekran słabo" },
        { id: "pierwszy-raz", text: "Jestem tu pierwszy raz" },
      ],
      correctOptionIds: [],
    },

    {
      kind: "single-choice",
      id: "rag-skrot",
      prompt: "Co oznacza skrót RAG?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "wyszukiwanie", text: "Retrieval-Augmented Generation" },
        { id: "losowe", text: "Random Answer Generation" },
        { id: "szybkie", text: "Rapid AI Gateway" },
        { id: "ranking", text: "Ranked Answer Grouping" },
      ],
      correctOptionIds: ["wyszukiwanie"],
    },

    {
      kind: "single-choice",
      id: "finetuning-po-co",
      prompt: "Po co robi się fine-tuning modelu?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        {
          id: "dostrojenie",
          text: "Żeby dostroić go do konkretnego zadania lub stylu",
        },
        { id: "szybkosc", text: "Żeby odpowiadał szybciej" },
        { id: "taniej", text: "Żeby był tańszy w utrzymaniu serwera" },
        { id: "internet", text: "Żeby miał dostęp do internetu" },
      ],
      correctOptionIds: ["dostrojenie"],
    },

    /**
     * The id deliberately says nothing about the answer — `definition.test.ts` checks that
     * a text question's id does not contain any accepted variant, because the open question's
     * id is in page source on every phone while it is being asked.
     */
    {
      kind: "text",
      id: "jednostka-tekstu",
      prompt:
        "Jak nazywa się jednostka tekstu, na której operuje model językowy?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      // The first entry is what the room sees at the reveal — canonical form first.
      acceptedAnswers: ["token", "tokeny", "tokenów"],
    },

    /**
     * A magnitude rather than a year: FR-013 scores a guess by *relative* error, so a
     * four-digit year would accept anything within about a century and the question would be
     * free.
     *
     * **This prompt may not contain the word "token".** The first draft asked about a context
     * window in tokens — which prints the accepted answer to `jednostka-tekstu` above into
     * every phone's page source at render, because both quizzes' projections are embedded at
     * page load. `public.test.ts`'s value-level scan caught it; the rule is that no prompt may
     * contain any *other* question's accepted answer, and it is easiest to keep by not reusing
     * the vocabulary.
     */
    {
      kind: "number",
      id: "chatgpt-uzytkownicy",
      prompt:
        "Ile milionów użytkowników miał ChatGPT dwa miesiące po premierze?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      correctValue: 100,
    },

    {
      kind: "multiple-choice",
      id: "ktore-to-modele",
      prompt: "Które z tych nazw to modele językowe?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "claude", text: "Claude" },
        { id: "llama", text: "Llama" },
        { id: "kubernetes", text: "Kubernetes" },
        { id: "postgres", text: "PostgreSQL" },
      ],
      correctOptionIds: ["claude", "llama"],
    },

    {
      kind: "single-choice",
      id: "gdzie-meetupy",
      prompt: "W jakim mieście spotyka się Brave AI Community?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "nadodra", text: "Szczecin" },
        { id: "nadwisla", text: "Warszawa" },
        { id: "nadmotlawa", text: "Gdańsk" },
        { id: "nadwarta", text: "Poznań" },
      ],
      correctOptionIds: ["nadodra"],
    },
  ],
} satisfies Quiz;
