import type { Quiz } from "./schema";

/**
 * The quiz, authored as source (PRD FR-001) — there is no builder interface and
 * no admin panel by design. Editing a question means editing this file and
 * deploying; the build gate rejects a malformed definition before it ships.
 *
 * Transcribed from the draft in `idea-notes.md`. Question ids describe the
 * subject rather than the position, so reordering the quiz cannot silently
 * reassign identity — session state and resume are keyed by these ids.
 *
 * `points: null` marks a question unscored (FR-017). Everything scored is worth
 * the same: nothing in the PRD asks for per-question weighting, so inventing one
 * here would be a decision without a reason.
 *
 * **`timeLimitSeconds` is the one thing that does vary per question (S-11), and it
 * varies by how much work the answer is, not by how hard it is.** Tapping one of four
 * options is `TAP_SECONDS`; typing a Polish word or reading a magnitude is
 * `TYPE_SECONDS`. Both sit at or above the 20-second speed window in `scoring.ts`, so
 * the whole reward curve stays reachable on every question — a shorter limit is legal
 * but compresses it, which the schema documents. The two unscored questions carry no
 * limit at all: their pacing is the host's, and the schema refuses a limit on them.
 */

const POINTS = 1000;

/** Long enough to read four options and tap one, on a phone, in a dark room. */
const TAP_SECONDS = 25;

/** Long enough to type an answer, including a correction. */
const TYPE_SECONDS = 40;

export const quizDefinition = {
  questions: [
    // Q1 — opens the segment. Unscored: watching your own word land on the big
    // screen is what proves the session is live (FR-012, FR-015).
    {
      kind: "word-cloud",
      id: "smieszne-slowo-ai",
      prompt: "Napisz śmieszne słowo związane z AI",
      points: null,
    },

    // Q2 — the gather question. Every answer is "right", so it is unscored
    // rather than carrying four correct ids (FR-010 resolves this via FR-017).
    {
      kind: "multiple-choice",
      id: "czy-wszyscy-gotowi",
      prompt: "Czy wszyscy są gotowi? Ostatnia szansa, by dołączyć do zabawy!",
      points: null,
      options: [
        { id: "gotowy", text: "Jestem gotowy/gotowa!" },
        { id: "wygram", text: "Wygram!" },
        { id: "ekscytacja", text: "Tak się ekscytuję!" },
        { id: "poczekajcie", text: "Poczekajcie, jeszcze ktoś dołącza!" },
      ],
      correctOptionIds: [],
    },

    {
      kind: "single-choice",
      id: "llm-skrot",
      prompt: "Co oznacza skrót LLM?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "large-language-model", text: "Large Language Model" },
        { id: "long-learning-machine", text: "Long Learning Machine" },
        { id: "layered-logic-module", text: "Layered Logic Module" },
        { id: "linear-language-method", text: "Linear Language Method" },
      ],
      correctOptionIds: ["large-language-model"],
    },

    // The id names the *question*, not the answer. It was `halucynacje` until S-02,
    // which is the accepted answer spelled out — and question ids necessarily reach
    // the browser, because the published snapshot identifies the open question by id.
    // An attendee reading page source had the answer. Ids describing their subject is
    // the convention (see the module docstring); this is the case where the subject
    // *is* the answer, so the convention has to bend.
    {
      kind: "text",
      id: "zmyslanie-faktow",
      prompt: "Jak nazywa się zjawisko, gdy AI z pełnym przekonaniem zmyśla fakty?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      acceptedAnswers: ["halucynacje", "halucynacja", "hallucinations", "hallucination"],
    },

    {
      kind: "single-choice",
      id: "temperatura-parametr",
      prompt: "Co reguluje parametr „temperatura” w modelach językowych?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "losowosc", text: "Losowość i kreatywność odpowiedzi" },
        { id: "dlugosc", text: "Maksymalną długość odpowiedzi" },
        { id: "szybkosc", text: "Szybkość generowania odpowiedzi" },
        { id: "pamiec", text: "Zużycie pamięci przez model" },
      ],
      correctOptionIds: ["losowosc"],
    },

    {
      kind: "single-choice",
      id: "hashtag-brave",
      prompt: "Jaki hashtag jest znakiem rozpoznawczym społeczności BRAVE?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "verybrave", text: "#veryBrave" },
        { id: "staybrave", text: "#stayBrave" },
        { id: "braveai", text: "#braveAI" },
        { id: "bebrave", text: "#beBrave" },
      ],
      correctOptionIds: ["verybrave"],
    },

    {
      kind: "single-choice",
      id: "brave-liczba-brandow",
      prompt: "Ile brandów/programów liczy obecnie rodzina BRAVE?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "trzy", text: "3" },
        { id: "piec", text: "5" },
        { id: "siedem", text: "7" },
        { id: "dziesiec", text: "10" },
      ],
      correctOptionIds: ["siedem"],
    },

    // Q8 — the only scored multi-answer question. All-or-nothing scoring is
    // S-03's rule; this file only records which options are correct.
    {
      kind: "multiple-choice",
      id: "summer-tour-zakonczenie",
      prompt: "Czym kończy się dzisiejszy Summer Tour w Szczecinie?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "kino", text: "Kinem plenerowym" },
        { id: "networking", text: "Networkingiem" },
        { id: "konkurs", text: "Konkursem z nagrodami" },
        { id: "warsztaty", text: "Warsztatami z promptowania" },
      ],
      correctOptionIds: ["kino", "networking"],
    },

    {
      kind: "single-choice",
      id: "hackathon-brave",
      prompt: "Jak nazywa się hackathon BRAVE, na który rozgrzewką był Summer Tour?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "unaited", text: "BRAVE UnAIted" },
        { id: "hackai", text: "BRAVE HackAI" },
        { id: "nextgen", text: "BRAVE NextGen" },
        { id: "aijam", text: "BRAVE AI Jam" },
      ],
      correctOptionIds: ["unaited"],
    },

    // Q10 and Q14 differ by two orders of magnitude — the case FR-013's
    // relative-error rule exists for. Only the true value lives here.
    {
      kind: "number",
      id: "lyro-automatyzacja",
      prompt: "Ile procent rozmów z klientami automatyzuje Lyro AI?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      correctValue: 67,
    },

    {
      kind: "single-choice",
      id: "huuuge-games",
      prompt: "Huuuge Games, partner naszego eventu, to producent:",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "mobilne", text: "Gier mobilnych" },
        { id: "konsolowe", text: "Gier konsolowych" },
        { id: "silniki", text: "Silników graficznych" },
        { id: "oprogramowanie", text: "Oprogramowania dla firm" },
      ],
      correctOptionIds: ["mobilne"],
    },

    {
      kind: "single-choice",
      id: "10xdevs-start",
      prompt: "Jesienna edycja 10xDevs 4.0 startuje:",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "1-wrzesnia", text: "1 września" },
        { id: "14-wrzesnia", text: "14 września" },
        { id: "28-wrzesnia", text: "28 września" },
        { id: "12-pazdziernika", text: "12 października" },
      ],
      correctOptionIds: ["14-wrzesnia"],
    },

    {
      kind: "single-choice",
      id: "ai-sales-prowadzacy",
      prompt: "Kto prowadzi program AI_Sales?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "negacz", text: "Szymon Negacz" },
        { id: "gospodarczyk", text: "Adam Gospodarczyk" },
        { id: "smyrdek", text: "Przemek Smyrdek" },
        { id: "mrugalski", text: "Jakub Mrugalski" },
      ],
      correctOptionIds: ["negacz"],
    },

    {
      kind: "number",
      id: "ai-devs-absolwenci",
      prompt:
        "Ilu absolwentów ma sam kurs AI_devs — najpopularniejszy kurs AI dla developerów w Polsce?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      correctValue: 10000,
    },
  ],
} satisfies Quiz;
