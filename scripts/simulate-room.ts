/**
 * A room of simulated attendees that YOU host (roadmap F-04's sibling).
 *
 * This is a rehearsal tool, not shipped behaviour. Nothing under `src/` may import it.
 *
 * ## What this is, and what `rehearse-room.ts` is
 *
 * `rehearse-room.ts` is a *probe*: it holds both roles, drives `start`/`advance`/
 * `reveal` itself on a fixed rhythm, measures snapshot arrival against the 1 s budget
 * and purges on the way out. You watch a report.
 *
 * This script holds only the *room*. It never calls a host verb and never holds
 * `LIVEQUIZ_HOST_SECRET` — you drive the session from `/quiz/host` (pick the quiz there) exactly as you will
 * on stage, and N bots join, watch the phase and answer on their own. What it rehearses
 * is the half a probe cannot: the host's own hands, the projector's copy at a real
 * question count, and whether a leaderboard built from a plausible spread of answers
 * reads well from the back of the room.
 *
 * The two are complementary and neither replaces the other. If you want a latency
 * figure, run the probe; if you want to practise running the quiz, run this.
 *
 * ## What it deliberately does NOT do
 *
 * - **No host verb.** Not even `start`: the script waits for your session instead, so
 *   there is no path by which it advances a question out from under you.
 * - **No purge on exit.** The session is yours; a script that tore it down on Ctrl-C
 *   would delete a room you were still standing in front of. Reset with
 *   `bun run quiz:reset` when you are done.
 * - **No Ably connection.** It polls `GET /api/quiz/state` on one loop instead. The
 *   fan-out is what the *probe* measures, and taking a connection slot per rehearsal
 *   costs against the same ceiling a real room needs — while a bot that learns a
 *   question opened ~1 s late is indistinguishable from an attendee who looked up ~1 s
 *   late, which is the thing being simulated anyway.
 *
 * ## Isolation — read this before pointing it anywhere but localhost
 *
 * There is no rehearsal-only namespace and no rehearsal-only channel (the reasoning is
 * in `rehearse-room.ts`). This script therefore joins the **real** session at
 * `--base`, and its bots are indistinguishable from attendees in the store, on the
 * leaderboard and in the word cloud. Against a production URL during an event that is
 * 25 fake people on the projector. It refuses a non-localhost base unless
 * `--i-know-this-is-not-local` is passed.
 *
 * Run:
 *   bun run dev                        # terminal 1
 *   bun run quiz:simulate              # terminal 2, then open /quiz/host, pick the quiz, press start
 *
 *   [--clients=25]        room size
 *   [--base=http://localhost:4321]
 *   [--correct=0.65]      share of bots that know the answer
 *   [--silent=0.08]       share of bots that answer nothing at all, per question
 *   [--seed=1]            same seed, same room and same answers
 */

import { MAX_WORD_LENGTH } from "../src/lib/session/words";
import { getQuestionById, getQuizByQuestionId } from "../src/quiz";
import type { Question } from "../src/quiz/schema";

type Config = {
  baseUrl: string;
  clients: number;
  correctRate: number;
  silentRate: number;
  seed: number;
};

/** How often the room checks what the host is doing. */
const POLL_MS = 1000;

/**
 * The window a bot spreads its answer over when the question carries no
 * `timeLimitSeconds` — the two unscored beats, which the host closes by hand whenever
 * the room has settled.
 */
const UNTIMED_WINDOW_MS = 15_000;

/** A bot never answers in the first moment; nobody reads a question that fast. */
const MIN_THINKING_MS = 1_200;

/** …and never on the buzzer, where a submission races the host's own close. */
const TAIL_GUARD_MS = 2_500;

const REQUEST_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------------- *
 * Determinism
 *
 * Seeded rather than `Math.random`, so "the leaderboard looked wrong at question 9"
 * is a thing you can hand to somebody else as one flag.
 * ------------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let random: () => number;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function between(min: number, max: number): number {
  return min + random() * (max - min);
}

/* ------------------------------------------------------------------------- *
 * The room
 * ------------------------------------------------------------------------- */

/**
 * Polish given names, so the leaderboard on the projector reads like a leaderboard
 * rather than like a load test. Diacritics on purpose — `ł`, `ó` and `ż` are where the
 * fold in `normalize.ts` earns its keep, and a room of ASCII names would never touch it.
 */
const FIRST_NAMES = [
  "Ala",
  "Bartek",
  "Celina",
  "Dawid",
  "Ewa",
  "Filip",
  "Gosia",
  "Hubert",
  "Iga",
  "Jarek",
  "Kasia",
  "Łukasz",
  "Marta",
  "Norbert",
  "Ola",
  "Paweł",
  "Radek",
  "Sylwia",
  "Tomek",
  "Urszula",
  "Wojtek",
  "Zosia",
  "Antek",
  "Basia",
  "Czarek",
  "Dorota",
  "Emil",
  "Franek",
  "Grażyna",
  "Halina",
] as const;

const SURNAME_INITIALS = "KWNSZMLPBDRTGJ";

type Bot = {
  index: number;
  displayName: string;
  /**
   * Its own device id, unique per bot.
   *
   * **Not cosmetic.** `claimPlayer` caps a device at `MAX_PLAYERS_PER_DEVICE` (3), so a
   * room of 25 bots sharing one id would see 3 claims accepted and 22 refused as
   * capped — and the refusal copy is about the attendee's phone, which would send you
   * looking at the wrong thing entirely.
   */
  deviceId: string;
  playerId: string | null;
  /** Question ids this bot has already submitted for, so a re-poll never double-sends. */
  answered: Set<string>;
};

function buildRoom(config: Config): Bot[] {
  const used = new Set<string>();

  return Array.from({ length: config.clients }, (_, index) => {
    let displayName = "";
    // Names are the uniqueness key, and the store folds them — so collide here, in the
    // room's own bookkeeping, rather than discovering it as a 409 in the join burst.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const first = pick(FIRST_NAMES);
      const initial =
        SURNAME_INITIALS[Math.floor(random() * SURNAME_INITIALS.length)];
      const candidate = `${first} ${initial}.`;
      if (!used.has(candidate.toLowerCase())) {
        displayName = candidate;
        break;
      }
    }
    if (displayName === "") displayName = `Gość ${index + 1}`;
    used.add(displayName.toLowerCase());

    return {
      index,
      displayName,
      deviceId: `sim-${config.seed}-${index}-${index.toString(36)}`,
      playerId: null,
      answered: new Set<string>(),
    };
  });
}

/* ------------------------------------------------------------------------- *
 * Talking to the app
 *
 * `Origin` on every POST for the reason `rehearse-room.ts` gives: Astro refuses a
 * cross-origin POST that reads `formData()` with a 403 *before* the handler runs, so
 * without it every request here fails for a reason that has nothing to do with the app.
 * ------------------------------------------------------------------------- */

type SessionSnapshot = {
  phase: string;
  currentQuestionId: string | null;
  version: number;
  playerCount: number | null;
};

async function readState(
  config: Config,
): Promise<{ state: SessionSnapshot | null; error: string | null }> {
  try {
    const response = await fetch(`${config.baseUrl}/api/quiz/state`, {
      headers: { "Cache-Control": "no-store" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      return {
        state: null,
        error:
          `${response.status} ${typeof body.error === "string" ? body.error : ""}`.trim(),
      };
    }

    const body = (await response.json()) as {
      state?: {
        phase?: unknown;
        currentQuestionId?: unknown;
        version?: unknown;
      } | null;
      playerCount?: unknown;
    };

    if (!body.state || typeof body.state.phase !== "string") {
      return { state: null, error: null };
    }

    return {
      state: {
        phase: body.state.phase,
        currentQuestionId:
          typeof body.state.currentQuestionId === "string"
            ? body.state.currentQuestionId
            : null,
        version:
          typeof body.state.version === "number" ? body.state.version : 0,
        playerCount:
          typeof body.playerCount === "number" ? body.playerCount : null,
      },
      error: null,
    };
  } catch (err) {
    return {
      state: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function joinOnce(
  config: Config,
  bot: Bot,
): Promise<{ ok: boolean; status: number; error: string | null }> {
  const form = new FormData();
  form.set("displayName", bot.displayName);
  form.set("deviceId", bot.deviceId);

  try {
    const response = await fetch(`${config.baseUrl}/api/quiz/join`, {
      method: "POST",
      headers: { Origin: config.baseUrl },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as {
      player?: { id?: unknown };
      error?: unknown;
    };

    if (response.status === 200 && typeof body.player?.id === "string") {
      bot.playerId = body.player.id;
      return { ok: true, status: 200, error: null };
    }

    return {
      ok: false,
      status: response.status,
      error: typeof body.error === "string" ? body.error : null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function submit(
  config: Config,
  bot: Bot,
  questionId: string,
  elapsedMs: number,
  fields: readonly (readonly [string, string])[],
): Promise<{ status: number; error: string | null }> {
  const form = new FormData();
  form.set("playerId", bot.playerId ?? "");
  form.set("questionId", questionId);
  form.set("elapsedMs", String(Math.round(elapsedMs)));
  for (const [name, value] of fields) form.append(name, value);

  try {
    const response = await fetch(`${config.baseUrl}/api/quiz/answer`, {
      method: "POST",
      headers: { Origin: config.baseUrl },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    return {
      status: response.status,
      error: typeof body.error === "string" ? body.error : null,
    };
  } catch (err) {
    return {
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------------------- *
 * What a bot answers
 *
 * The point of the spread is the *screens*: an all-correct room makes every
 * distribution bar a single block and every leaderboard a 25-way tie, which is exactly
 * the state in which a projector layout looks fine and then does not on the night.
 * ------------------------------------------------------------------------- */

/** Wrong-but-plausible text answers for the hallucination question. */
const TEXT_DECOYS = [
  "konfabulacje",
  "zmyślanie",
  "fantazjowanie",
  "kreatywność",
  "błąd modelu",
] as const;

/** Word-cloud submissions. Repeats are the point — a cloud with 25 singletons is a list. */
const CLOUD_WORDS = [
  "halucynacje",
  "halucynacje",
  "halucynacje",
  "prompt",
  "prompt",
  "prompt",
  "embedding",
  "embedding",
  "token",
  "token",
  "tokenizacja",
  "transformer",
  "atencja",
  "kwantyzacja",
  "finetuning",
  "temperatura",
  "wektor",
  "agent",
  "kontekst",
  "inferencja",
  "przeuczenie",
  "sztuczna",
  "promptowanie",
  "latencja",
] as const;

/**
 * A numeric guess, drawn from the closeness bands themselves (`scoring.ts`) rather than
 * from a normal distribution around the answer.
 *
 * The bands are the thing worth exercising: a spread that happens to land every guess
 * inside 5 % pays out 0.80 across the board and never shows you what a partial-credit
 * leaderboard looks like when three people are on 800 and one is on 1000.
 */
function numericGuess(correctValue: number, knowsIt: boolean): string {
  const roll = random();
  let relativeError: number;

  if (knowsIt) {
    if (roll < 0.35) relativeError = 0;
    else if (roll < 0.7) relativeError = between(0.001, 0.05);
    else relativeError = between(0.05, 0.1);
  } else {
    if (roll < 0.4) relativeError = between(0.1, 0.25);
    else relativeError = between(0.25, 1.4);
  }

  const sign = random() < 0.5 ? -1 : 1;
  const raw = correctValue * (1 + sign * relativeError);
  const guess = Math.max(0, Math.round(raw));

  /**
   * One guess in six is typed with a space as a group separator, because that is how a
   * person types 10 000 on a phone and because `parseGuess` accepts it *only* in
   * grouping positions. A room that only ever sends bare digits never touches that path.
   *
   * The separator `Intl` emits is U+00A0, which `GROUPING` in `guess.ts` accepts
   * alongside a plain space — so it is left as the formatter wrote it rather than
   * normalised, and the non-breaking path gets exercised too.
   */
  if (guess >= 1000 && random() < 0.17) {
    return guess.toLocaleString("pl-PL");
  }
  return String(guess);
}

/**
 * The form fields one bot posts for one question, or `null` for a bot that says nothing.
 *
 * Silence is modelled per question rather than per bot: a room where the same two people
 * never answer is a room where the answered counter is stable, and the counter drifting
 * is what the host actually watches while deciding when to close.
 */
function answerFor(
  config: Config,
  question: Question,
): readonly (readonly [string, string])[] | null {
  if (random() < config.silentRate) return null;

  const knowsIt = random() < config.correctRate;

  if (
    question.kind === "single-choice" ||
    question.kind === "multiple-choice"
  ) {
    const correct = question.correctOptionIds;
    const optionIds = question.options.map((option) => option.id);

    // The unscored gather beat has no correct answer at all; every option is a mood.
    if (correct.length === 0) {
      return [["optionIds", pick(optionIds)]];
    }

    if (knowsIt) {
      return correct.map((id) => ["optionIds", id] as const);
    }

    const wrong = optionIds.filter((id) => !correct.includes(id));
    if (wrong.length === 0) return [["optionIds", pick(optionIds)]];

    /**
     * A near-miss on the one multi-answer question: half the wrong bots send one right
     * option and one wrong one. Scoring there is all-or-nothing, so this is the case
     * that proves a partially-right answer pays zero — and it is invisible in a room
     * that only ever answers fully right or fully wrong.
     */
    if (question.kind === "multiple-choice" && random() < 0.5) {
      return [
        ["optionIds", pick(correct)] as const,
        ["optionIds", pick(wrong)] as const,
      ];
    }

    return [["optionIds", pick(wrong)]];
  }

  if (question.kind === "text") {
    if (!knowsIt) return [["text", pick(TEXT_DECOYS)]];

    const accepted = pick(question.acceptedAnswers);
    // Typed the way people type: sometimes capitalised, sometimes with a stray space.
    const roll = random();
    if (roll < 0.2) return [["text", accepted.toUpperCase()]];
    if (roll < 0.35) return [["text", ` ${accepted} `]];
    return [["text", accepted]];
  }

  if (question.kind === "number") {
    return [["value", numericGuess(question.correctValue, knowsIt)]];
  }

  if (question.kind === "word-cloud") {
    // The bound is the projector's, not the field's — one word, folded for case only.
    return [["word", pick(CLOUD_WORDS).slice(0, MAX_WORD_LENGTH)]];
  }

  return null;
}

/* ------------------------------------------------------------------------- *
 * The loop
 * ------------------------------------------------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function windowMsFor(question: Question): number {
  return question.points === null || question.timeLimitSeconds === undefined
    ? UNTIMED_WINDOW_MS
    : question.timeLimitSeconds * 1000;
}

type QuestionTally = {
  /** Bots that were given a moment to answer at, whether or not it has arrived yet. */
  scheduled: number;
  submitted: number;
  accepted: number;
  silent: number;
  refusals: Map<string, number>;
};

/**
 * Runs one question: every bot that has not answered it picks a moment inside the
 * window and posts then.
 *
 * Fire-and-forget rather than awaited, because the host may close the question early —
 * and a loop that awaited its own schedule would keep submitting into a phase that has
 * moved on, then report a wall of refusals that describe the harness rather than the app.
 */
function runQuestion(
  config: Config,
  bots: Bot[],
  question: Question,
  openedAt: number,
  tally: QuestionTally,
): void {
  const window = windowMsFor(question);
  const latest = Math.max(MIN_THINKING_MS + 500, window - TAIL_GUARD_MS);

  for (const bot of bots) {
    if (bot.playerId === null || bot.answered.has(question.id)) continue;
    bot.answered.add(question.id);

    const fields = answerFor(config, question);
    if (fields === null) {
      tally.silent += 1;
      continue;
    }

    tally.scheduled += 1;
    const delay = between(MIN_THINKING_MS, latest);

    setTimeout(() => {
      const elapsed = performance.now() - openedAt;
      void submit(config, bot, question.id, elapsed, fields).then((result) => {
        tally.submitted += 1;
        if (result.status === 200) {
          tally.accepted += 1;
          return;
        }
        const reason = `${result.status} ${result.error ?? "brak szczegółów"}`;
        tally.refusals.set(reason, (tally.refusals.get(reason) ?? 0) + 1);
      });
    }, delay);
  }
}

function reportQuestion(question: Question, tally: QuestionTally): void {
  const parts = [`${tally.accepted} przyjętych`, `${tally.silent} milczało`];
  const failed = tally.submitted - tally.accepted;
  if (failed > 0) parts.push(`${failed} odrzuconych`);

  /**
   * Bots whose moment had not come when the host closed the question.
   *
   * Reported rather than dropped: closing a 25-second question after eight seconds is
   * an ordinary thing for a host to do, and without this line the counts simply fail to
   * add up to the room — which reads as the harness losing answers.
   */
  const inFlight = tally.scheduled - tally.submitted;
  if (inFlight > 0) parts.push(`${inFlight} nie zdążyło (zamknąłeś wcześniej)`);

  console.log(`  ✓ ${question.id} — ${parts.join(", ")}`);
  for (const [reason, count] of tally.refusals) {
    console.log(`      ${count}× ${reason}`);
  }
}

async function joinRoom(config: Config, bots: Bot[]): Promise<number> {
  const startedAt = performance.now();
  const results = await Promise.all(bots.map((bot) => joinOnce(config, bot)));
  const elapsed = Math.round(performance.now() - startedAt);

  const accepted = results.filter((result) => result.ok).length;
  console.log(
    `\n  Dołączyło ${accepted}/${bots.length} botów w ${elapsed} ms\n`,
  );

  const byReason = new Map<string, number>();
  for (const result of results) {
    if (result.ok) continue;
    const reason = `${result.status} ${result.error ?? "brak szczegółów"}`;
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  for (const [reason, count] of byReason) {
    console.log(`      ${count}× ${reason}`);
  }

  if (accepted > 0) {
    console.log(
      `      np. ${bots
        .filter((bot) => bot.playerId !== null)
        .slice(0, 4)
        .map((bot) => bot.displayName)
        .join(", ")}…\n`,
    );
  }

  return accepted;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return found?.slice(prefix.length) || undefined;
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveConfig(): Config | null {
  const rawBase =
    arg("base") ?? process.env.LIVEQUIZ_BASE_URL ?? "http://localhost:4321";

  let baseUrl: string;
  try {
    baseUrl = new URL(rawBase).origin;
  } catch {
    console.error(` FAIL  "${rawBase}" nie jest adresem URL`);
    return null;
  }

  const host = new URL(baseUrl).hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!isLocal && !process.argv.includes("--i-know-this-is-not-local")) {
    console.error(
      `\n FAIL  ${baseUrl} nie jest lokalny.\n\n` +
        "        Ten skrypt dołącza do PRAWDZIWEJ sesji pod tym adresem — nie ma\n" +
        "        osobnego namespace'u dla symulacji. 25 botów wejdzie na tablicę\n" +
        "        wyników i do chmury słów tak samo jak publiczność.\n\n" +
        "        Jeśli o to właśnie chodzi: dopisz --i-know-this-is-not-local\n",
    );
    return null;
  }

  const clients = Math.max(0, Math.floor(numberArg("clients", 25)));
  const correctRate = Math.min(1, Math.max(0, numberArg("correct", 0.65)));
  const silentRate = Math.min(1, Math.max(0, numberArg("silent", 0.08)));
  const seed = Math.floor(numberArg("seed", 1));

  return { baseUrl, clients, correctRate, silentRate, seed };
}

async function main(): Promise<void> {
  const config = resolveConfig();
  if (config === null) {
    process.exit(1);
  }

  random = mulberry32(config.seed);
  const bots = buildRoom(config);

  console.log(
    `\nSymulacja sali — ${config.clients} botów przeciwko ${config.baseUrl}\n` +
      `  ${Math.round(config.correctRate * 100)}% zna odpowiedź, ` +
      `${Math.round(config.silentRate * 100)}% milczy, seed ${config.seed}\n` +
      "  Ty prowadzisz z /quiz/host (wybierz quiz) — skrypt nie dotyka żadnego verbu hosta.\n",
  );

  let closing = false;
  process.on("SIGINT", () => {
    closing = true;
    console.log(
      "\n\n  Kończę. Sesja zostaje — wyczyść ją przez `bun run quiz:reset`.\n",
    );
    process.exit(0);
  });

  // Wait for the host to press start. No verb from here, ever.
  console.log("  Czekam aż wystartujesz sesję…");
  let joined = 0;
  let lastQuestionId: string | null = null;
  let lastPhase: string | null = null;
  const tallies = new Map<string, QuestionTally>();

  while (!closing) {
    const { state, error } = await readState(config);

    if (error !== null) {
      console.log(`  ·· stan niedostępny — ${error}`);
      await sleep(POLL_MS * 3);
      continue;
    }

    if (state === null) {
      // No session. Either the host has not started yet, or it was purged under us —
      // in which case the bots' player ids are dead and the room has to re-join.
      if (joined > 0) {
        console.log("\n  Sesja zniknęła (purge?) — czekam na następną.\n");
        joined = 0;
        for (const bot of bots) {
          bot.playerId = null;
          bot.answered.clear();
        }
        tallies.clear();
        lastQuestionId = null;
      }
      await sleep(POLL_MS);
      continue;
    }

    if (joined === 0) {
      console.log(`  Sesja żyje (faza "${state.phase}") — dołączam.`);
      joined = await joinRoom(config, bots);
      if (joined === 0) {
        console.log("  Żaden bot nie wszedł. Przerywam.\n");
        process.exit(1);
      }
      console.log("  Prowadź. Odpowiedzi lecą same.\n");
    }

    if (state.phase !== lastPhase) {
      if (state.phase === "standings") console.log("  ▸ ranking na ekranie");
      if (state.phase === "ended") console.log("\n  ▸ sesja zamknięta.\n");
      lastPhase = state.phase;
    }

    if (
      state.phase === "question-open" &&
      state.currentQuestionId !== null &&
      state.currentQuestionId !== lastQuestionId
    ) {
      lastQuestionId = state.currentQuestionId;
      const question = getQuestionById(state.currentQuestionId);

      if (question !== undefined) {
        // The counter is "where in *this* quiz", so it comes from the quiz that owns the
        // question rather than from a single committed one (multiple-quizzes).
        const running = getQuizByQuestionId(question.id)?.questions ?? [];
        const index = running.indexOf(question) + 1;
        console.log(
          `  ▸ pytanie ${index}/${running.length} (${question.kind}) — ` +
            `okno ${Math.round(windowMsFor(question) / 1000)} s`,
        );

        const tally: QuestionTally = {
          scheduled: 0,
          submitted: 0,
          accepted: 0,
          silent: 0,
          refusals: new Map(),
        };
        tallies.set(question.id, tally);
        runQuestion(config, bots, question, performance.now(), tally);
      }
    }

    /**
     * The report lands on the *reveal*, not on a timer, because that is when the
     * question is genuinely over — a host who closes early still gets an honest count,
     * and one who lets the clock run out gets it at the same moment the room does.
     */
    if (state.phase === "question-revealed" && lastQuestionId !== null) {
      const tally = tallies.get(lastQuestionId);
      const question = getQuestionById(lastQuestionId);
      if (tally !== undefined && question !== undefined) {
        // Give the last in-flight submissions a beat to land before counting them.
        await sleep(600);
        reportQuestion(question, tally);
        tallies.delete(lastQuestionId);
      }
    }

    await sleep(POLL_MS);
  }
}

await main();
