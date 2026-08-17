import type { Quiz } from "../schema";

/**
 * The quiz for BRAVE UnAIted — the hackathon-and-school-disco day for BRAVE alumni.
 *
 * **Editorial rule for this file: nothing about the event's own logistics.** The room
 * playing this quiz is standing *in* the venue, so "where is the hackathon", "how big is
 * a team" and "when is lunch" are questions whose answers are on the wall behind the
 * projector.
 *
 * **The centre of gravity is 1990s subculture, played for nostalgia**, with BRAVE bookending
 * it. That follows the evening's own motif — the party is a *szkolna dyskoteka* and the join
 * code is a year — so the questions are the things this room actually held in its hands:
 * a pencil in a cassette, a floppy carrying your whole life, chat-room shorthand, an MP3
 * player with a rude slogan, an egg you had to feed at break. Every scored question is meant
 * to be *podchwytliwe*: the obvious answer is wrong often enough that leading the board takes
 * attention rather than reflexes.
 *
 * Four constraints bit while writing this and are easy to re-break on an edit:
 *
 * - **No prompt or option text may contain any question's accepted answer**, because all
 *   three quizzes' projections are embedded in every phone's page source at render, and
 *   `public.test.ts` scans by value across the whole registry. So Q6 and Q9 describe their
 *   answers without naming them, and nothing here reuses the other quizzes' vocabulary.
 * - **No prompt or option text may contain any quiz's join `code`** — same scan, same reason.
 *   An earlier draft of Q11 asked what happened "in 1990" and failed on it; the fix was to
 *   stop printing the year, not to change the code.
 * - **A `number` question's true value is matched as a bare substring by that same scan**, so
 *   a small integer is unusable — `String(3)` occurs in half the serialized projection. Any
 *   question with a small numeric answer has to be `single-choice`, and none of the text here
 *   may contain the other quizzes' `67`, `100` or `10000`.
 * - **A year may not be a `number` question.** Scoring bands on *relative* error, so 1996
 *   against 1997 is a 0.05% miss and full marks. Every date here is `single-choice`; the one
 *   `number` question is a magnitude, where partial credit means something.
 *
 * Everything else follows `summer-tour-szczecin.ts` and `jesienny-meetup-ai.ts`: the opener
 * scores nothing, scored questions carry `timeLimitSeconds` and unscored ones may not, ids
 * are unique across the whole registry (hence the `unaited-` prefix) and no id gives away
 * its own answer. All of it is refused at the build gate.
 */

const POINTS = 1000;

/** Long enough to read four options and tap one, on a phone, in a dark room. */
const TAP_SECONDS = 25;

/** Long enough to type an answer, including a correction. */
const TYPE_SECONDS = 30;

export const unaited = {
  id: "unaited",
  title: "BRAVE UnAIted",
  code: "1990",
  questions: [
    // Q1 — opens the segment. Unscored: watching your own word land on the big screen
    // is what proves the session is live (FR-012, FR-015).
    {
      kind: "word-cloud",
      id: "unaited-nazwa-agenta",
      prompt:
        "Jak nazwałbyś swojego agenta AI, gdyby siedział z Tobą w ostatniej ławce?",
      points: null,
    },

    // Q2 — the gather beat. Every answer is "right", so it is unscored rather than
    // carrying correct ids (FR-010 resolves this via FR-017).
    {
      kind: "multiple-choice",
      id: "unaited-tryb-startowy",
      prompt: "W jakim trybie dziś jesteś?",
      points: null,
      options: [
        { id: "buduje", text: "Buduję" },
        { id: "tancze", text: "Tańczę" },
        { id: "jedno-i-drugie", text: "Jedno i drugie, w tej kolejności" },
        { id: "obserwuje", text: "Obserwuję i notuję" },
      ],
      correctOptionIds: [],
    },

    /**
     * Opens the nostalgia block on the object everyone in this room owned. The distractors
     * are all things a pencil plausibly did to a tape deck, which is what stops it being a
     * gimme.
     */
    {
      kind: "single-choice",
      id: "unaited-olowek-i-kaseta",
      prompt:
        "Po co w latach 90. sięgało się po ołówek, gdy w grę wchodziła kaseta?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "przewijanie", text: "Żeby nawinąć wysnutą taśmę z powrotem" },
        { id: "glowica", text: "Żeby wyczyścić głowicę magnetofonu" },
        {
          id: "klapka",
          text: "Żeby podeprzeć klapkę, która nie chciała się trzymać",
        },
        {
          id: "tracklista",
          text: "Żeby przedziurawić zabezpieczenie przed nagraniem",
        },
      ],
      correctOptionIds: ["przewijanie"],
    },

    /**
     * The trap is `14,4 MB`: 14.4 was the modem, not the disk. Both numbers lived in the same
     * decade and the same sentence, which is exactly why the pair works.
     */
    {
      kind: "single-choice",
      id: "unaited-dyskietka-pojemnosc",
      prompt: "Ile danych mieściła dyskietka 3,5 cala w standardzie HD?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "jeden-i-czterdziesci-cztery", text: "1,44 MB" },
        { id: "czternascie-cztery", text: "14,4 MB" },
        { id: "siedemset-dwadziescia", text: "720 KB" },
        { id: "czterdziesci-cztery", text: "44 MB" },
      ],
      correctOptionIds: ["jeden-i-czterdziesci-cztery"],
    },

    /**
     * Chat-room shorthand, and the first thing anybody was asked on IRC. The distractors are
     * all expansions somebody has genuinely guessed out loud.
     */
    {
      kind: "single-choice",
      id: "unaited-skrot-z-czatu",
      prompt: "O co pytał skrót „ASL?”, którym witano Cię na czacie?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "wiek-plec-miasto", text: "Wiek, płeć, miejsce zamieszkania" },
        { id: "zalogowany", text: "Czy nadal jesteś zalogowany" },
        { id: "jedna-linia", text: "Prośbę o odpowiedź w jednej linii" },
        { id: "predkosc", text: "Jak szybkie masz połączenie" },
      ],
      correctOptionIds: ["wiek-plec-miasto"],
    },

    /**
     * The id names the subject, not the answer — the open question's id reaches every phone's
     * page source while it is being asked, and the prompt quotes the slogan rather than the
     * program for the same reason.
     */
    {
      kind: "text",
      id: "unaited-slogan-o-lamie",
      prompt:
        "Który odtwarzacz MP3 chwalił się sloganem „it really whips the llama's ass”?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      // The first entry is what the room sees at the reveal — canonical spelling first.
      acceptedAnswers: ["Winamp"],
    },

    // Three of the four are genuinely 90s bands; the odd one out is a 2001 debut.
    {
      kind: "single-choice",
      id: "unaited-nie-z-lat-90",
      prompt:
        "Który z tych zespołów NIE zmieściłby się na składance z lat 90., bo powstał już w XXI wieku?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "tokio-hotel", text: "Tokio Hotel" },
        { id: "backstreet-boys", text: "Backstreet Boys" },
        { id: "spice-girls", text: "Spice Girls" },
        { id: "aqua", text: "Aqua" },
      ],
      correctOptionIds: ["tokio-hotel"],
    },

    // Three real BRAVE programmes and one that sounds exactly as plausible.
    {
      kind: "single-choice",
      id: "unaited-nie-ma-w-brave",
      prompt: "Który z tych programów NIE istnieje w rodzinie BRAVE?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "ai-lawyers", text: "AI_Lawyers" },
        { id: "ai-marketers", text: "AI_Marketers" },
        { id: "ai-sales", text: "AI_Sales" },
        { id: "ai-managers", text: "AI_Managers" },
      ],
      correctOptionIds: ["ai-lawyers"],
    },

    /**
     * Described rather than named, for the same reason as Q6 — and the id says nothing either.
     * The first pet that could die of your inattention during a maths lesson.
     */
    {
      kind: "text",
      id: "unaited-jajko-z-ekranem",
      prompt:
        "Jak nazywało się jajko z ekranem LCD, które od 1997 roku trzeba było karmić na każdej przerwie?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      acceptedAnswers: ["Tamagotchi"],
    },

    // Polish 90s prime time. „Idź na całość” is the tempting wrong answer — that was the zonk.
    {
      kind: "single-choice",
      id: "unaited-samogloska-w-teleturnieju",
      prompt: "W którym teleturnieju kupowało się samogłoskę?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "kolo-fortuny", text: "Koło Fortuny" },
        { id: "idz-na-calosc", text: "Idź na całość" },
        { id: "va-banque", text: "Va banque" },
        { id: "familiada", text: "Familiada" },
      ],
      correctOptionIds: ["kolo-fortuny"],
    },

    /**
     * The one people misdate in both directions: Google feels like the 2000s and the iPod
     * feels like the 90s. All-or-nothing scoring is `scoring.ts`'s rule; this file only
     * records which two really made it.
     *
     * **The prompt may not print the year**, because the join code is a year — see the module
     * docstring. That is why it says „w latach 90.” rather than naming one.
     */
    {
      kind: "multiple-choice",
      id: "unaited-co-juz-bylo",
      prompt: "Co z tej listy istniało już w latach 90.?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "google", text: "Google" },
        { id: "windows-95", text: "Windows 95" },
        { id: "ipod", text: "iPod" },
        { id: "youtube", text: "YouTube" },
      ],
      correctOptionIds: ["google", "windows-95"],
    },

    /**
     * Everybody in the room has heard these six seconds thousands of times and nobody knows
     * who wrote them. The kicker, worth saying out loud at the reveal: he composed it on a Mac.
     */
    {
      kind: "single-choice",
      id: "unaited-dzwiek-startowy",
      prompt: "Kto skomponował dźwięk powitalny Windows 95?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        { id: "eno", text: "Brian Eno" },
        { id: "moby", text: "Moby" },
        { id: "jarre", text: "Jean-Michel Jarre" },
        { id: "vangelis", text: "Vangelis" },
      ],
      correctOptionIds: ["eno"],
    },

    /**
     * A magnitude, so FR-013's relative-error bands mean something — a guess of 15 000 lands
     * in a band, a guess of 2 000 does not. The other quizzes' true values are avoided by
     * value as well as by id (see the module docstring).
     */
    {
      kind: "number",
      id: "unaited-absolwenci-brave",
      prompt: "Ilu absolwentów przewinęło się przez całą platformę BRAVE?",
      points: POINTS,
      timeLimitSeconds: TYPE_SECONDS,
      correctValue: 20000,
    },

    // Closes on the people in the room. All four names really are BRAVE course authors.
    {
      kind: "single-choice",
      id: "unaited-10xdevs-duet",
      prompt: "Który duet prowadzi 10xDevs?",
      points: POINTS,
      timeLimitSeconds: TAP_SECONDS,
      options: [
        {
          id: "czarkowski-smyrdek",
          text: "Marcin Czarkowski i Przemek Smyrdek",
        },
        {
          id: "gospodarczyk-mrugalski",
          text: "Adam Gospodarczyk i Jakub Mrugalski",
        },
        { id: "chrobok-pucek", text: "Mateusz Chrobok i Bartek Pucek" },
        { id: "jablonski-kacala", text: "Artur Jabłoński i Piotrek Kacała" },
      ],
      correctOptionIds: ["czarkowski-smyrdek"],
    },
  ],
} satisfies Quiz;
