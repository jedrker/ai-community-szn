import { describe, expect, it } from "vitest";

import type { PublicQuestion } from "../../quiz/public";
import type { SessionPhase } from "../session/state";

import {
  atLastQuestion,
  NO_SESSION,
  pollTargetFor,
  verbsFor,
  type ControlPhase,
  type FlowAction,
  type PollState,
} from "./controls";

/**
 * THE HOST PANEL'S PHASE RULES, RUN RATHER THAN READ (test-plan rollout phase 1).
 *
 * `host.test.ts` guarded this decision for four slices by scanning the table's own literal,
 * and that shape of guard cannot answer the question Risk #1 actually asks. *Does the panel
 * offer a verb the route refuses?* is a statement about `src/pages/api/quiz/host/*`, and no
 * reading of the panel's source can check it — a scan for an expression that exists today
 * certifies whatever is there, defects included (`lessons.md`). So the decision moved to
 * `controls.ts` and this file executes it against what the routes do.
 *
 * **The property is a one-way implication, not an equality**, and getting that wrong is the
 * plausible mistake here. The panel deliberately offers *less* than the routes accept in
 * several places, so `allow === accepted` fails on correct code. What holds is:
 *
 *   1. no verb in `allow` is one the route would refuse; and
 *   2. every verb the route would act on but the panel withholds is named in
 *      `MATERIAL_WITHHOLDINGS`, with a reason.
 *
 * Together those are a closed set: the panel cannot silently gain a dead button, and it
 * cannot silently lose a live one.
 */

/* -------------------------------------------------------------------------- */
/* Route legality                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a route does with an authorized, well-formed request in a given phase.
 *
 * - `effect` — it changes something the room can see. This includes the `standings` re-tap
 *   in the `standings` phase, which answers `applied: false` but **re-broadcasts**: the
 *   state does not move, the projector and 150 phones still receive the board, and that
 *   re-send is the entire recovery path its own 502 tells the host to take. Classing it as
 *   a no-op would make the panel's most-argued-about button look like decoration.
 * - `no-op` — HTTP 200 with `applied: false` and nothing reaching a device.
 * - `refused` — 409. Offering one of these is the dead button Risk #1 is about.
 */
type RouteOutcome = "effect" | "no-op" | "refused";

/**
 * The routes' behaviour, transcribed from their guards
 * (`src/pages/api/quiz/host/{start,advance,reveal,standings,end}.ts` and `host.ts`).
 *
 * **This table is hand-maintained, and that is the known weakness of this test.** Route
 * legality lives in branches inside handlers; it is not machine-readable, so nothing here
 * fails if a route's phase rule changes and this literal does not. What executes the routes
 * themselves is `src/pages/api/quiz/host/routes.test.ts` — read it before editing a cell.
 *
 * A `Record` over the phase union rather than a plain object: adding a member to
 * `SessionPhase` fails `astro check` here until this table gains a row, so a new phase
 * cannot arrive with the panel's rules unexamined.
 *
 * One route asymmetry worth knowing, because it looks like a transcription error:
 * **`reveal` refuses inconsistently.** It answers 409 in `lobby`, `standings` and `ended`,
 * but `question-revealed` has no 409 branch at all and falls through to the generic no-op.
 * Same user-visible situation, two contracts. Recorded, not tidied.
 */
const ROUTE_OUTCOMES: Record<ControlPhase, Record<FlowAction, RouteOutcome>> = {
  [NO_SESSION]: {
    start: "effect",
    advance: "refused",
    reveal: "refused",
    standings: "refused",
    end: "refused",
  },
  lobby: {
    start: "no-op",
    advance: "effect",
    reveal: "refused",
    standings: "refused",
    // No `lobby` guard in `end.ts`. The route would accept it; only the panel withholds.
    end: "effect",
  },
  "question-open": {
    start: "no-op",
    advance: "effect",
    reveal: "effect",
    standings: "refused",
    end: "refused",
  },
  "question-revealed": {
    start: "no-op",
    advance: "effect",
    // The fall-through described above, rather than the 409 the other phases give.
    reveal: "no-op",
    standings: "effect",
    end: "effect",
  },
  standings: {
    start: "no-op",
    advance: "effect",
    reveal: "refused",
    // Re-publishes. See `RouteOutcome`.
    standings: "effect",
    end: "effect",
  },
  ended: {
    start: "no-op",
    advance: "no-op",
    reveal: "refused",
    standings: "refused",
    end: "no-op",
  },
};

/**
 * The one cell that depends on where in the quiz the session is, rather than on the phase.
 *
 * `advance` past the last question is a 200 no-op — `nextQuestionId` returns `null`
 * (`state.ts`), so `advance.ts` returns null and nothing moves. The *phase* cannot see that,
 * which is the whole reason `verbsFor` takes a second parameter. No other route has a
 * last-question variant, so this is an override rather than a second table.
 */
const LAST_QUESTION_OVERRIDES: Partial<
  Record<ControlPhase, Partial<Record<FlowAction, RouteOutcome>>>
> = {
  "question-open": { advance: "no-op" },
  "question-revealed": { advance: "no-op" },
  standings: { advance: "no-op" },
};

function routeOutcome(
  phase: ControlPhase,
  action: FlowAction,
  atLast: boolean,
): RouteOutcome {
  const override = atLast
    ? LAST_QUESTION_OVERRIDES[phase]?.[action]
    : undefined;
  return override ?? ROUTE_OUTCOMES[phase][action];
}

/* -------------------------------------------------------------------------- */
/* The deliberate withholdings                                                */
/* -------------------------------------------------------------------------- */

type Withholding = {
  readonly phase: ControlPhase;
  readonly atLast: boolean;
  readonly action: FlowAction;
  readonly reason: string;
};

/**
 * Where the panel offers **less** than the route would act on.
 *
 * Two tiers, because they need different justification, and only one of them is listed here:
 *
 * - A verb withheld where the route is a **no-op** needs no entry. The panel is declining to
 *   offer a button that would do nothing, which is the thing the phase rules exist to
 *   remove. `start` mid-session, `advance` past the last question and `reveal` in
 *   `question-revealed` are all this.
 * - A verb withheld where the route has an **effect** is a decision, and it is listed here
 *   with its reason. Adding or removing one has to be deliberate, because each is a capability
 *   the host can see the route has and the panel is choosing not to hand them.
 *
 * Exactly three, and the assertion below is an equality in both directions: an unlisted
 * material withholding fails, and a listed one that is no longer withheld fails too. That
 * second half is what stops the list rotting into a permanent excuse.
 */
const MATERIAL_WITHHOLDINGS: readonly Withholding[] = [
  {
    phase: "lobby",
    atLast: false,
    action: "end",
    reason:
      "A session nobody has played is closed from the terminal, not by the one control on " +
      "this page that cannot be undone.",
  },
  {
    phase: "question-revealed",
    atLast: true,
    action: "standings",
    reason:
      "The closing beat publishes the final board itself (S-10), so a separate board here " +
      "is one the room is about to be shown again.",
  },
  {
    phase: "standings",
    atLast: true,
    action: "standings",
    reason:
      "Unreachable going forward — the row above no longer offers the board on the last " +
      "question — but a session already standing here when this shipped still renders " +
      "through it, and `zakończ sesję` is the one step left either way.",
  },
];

/* -------------------------------------------------------------------------- */
/* The decision surface                                                       */
/* -------------------------------------------------------------------------- */

const PHASES: readonly ControlPhase[] = [
  NO_SESSION,
  "lobby",
  "question-open",
  "question-revealed",
  "standings",
  "ended",
];

const ACTIONS: readonly FlowAction[] = [
  "start",
  "advance",
  "reveal",
  "standings",
  "end",
];

const POSITIONS: readonly boolean[] = [false, true];

/**
 * The three phases that carry no current question, so `atLast` can never be true in them.
 *
 * `QUESTIONLESS_PHASES` in `state.ts` is `lobby` and `ended`; `NO_SESSION` joins them here
 * because there is no document at all. `atLastQuestion` answers `false` for a null
 * `currentQuestionId`, which is what makes `verbsFor("lobby", true)` unreachable from the
 * page — asserted below rather than assumed, so this list cannot drift from the predicate.
 */
const QUESTIONLESS: readonly ControlPhase[] = [NO_SESSION, "lobby", "ended"];

/**
 * Every phase × position the panel can be asked about — twelve, of which **nine are
 * reachable**.
 *
 * The distinction earns its keep in the withholding sweep below and nowhere else. That test
 * is an equality over decisions somebody deliberately made, and the first run of it demanded
 * a fourth entry for `end` in `lobby` *on the last question* — a state with no current
 * question, which is a phantom rather than a capability withheld from anyone. Listing it
 * would have put a line in `MATERIAL_WITHHOLDINGS` that no host could ever reach.
 *
 * Every other assertion runs over all twelve: `verbsFor` answers an unreachable pair anyway,
 * and "it does something sane there" is worth having for free.
 */
function everyDecision(): { phase: ControlPhase; atLast: boolean }[] {
  return PHASES.flatMap((phase) =>
    POSITIONS.map((atLast) => ({ phase, atLast })),
  );
}

function reachableDecisions(): { phase: ControlPhase; atLast: boolean }[] {
  return everyDecision().filter(
    ({ phase, atLast }) => !(atLast && QUESTIONLESS.includes(phase)),
  );
}

function label(phase: ControlPhase, atLast: boolean): string {
  return `${phase}${atLast ? " (last question)" : ""}`;
}

describe("the decision covers every state the panel can be in", () => {
  it("asks about twelve decisions, nine of them reachable", () => {
    // Non-vacuity, the same guard `host.test.ts` puts over its own extractions: a `PHASES`
    // that fell to zero would make every `for` loop below pass by never running.
    expect(everyDecision()).toHaveLength(12);
    expect(reachableDecisions()).toHaveLength(9);
    expect(PHASES).toContain(NO_SESSION);
  });

  /**
   * **What makes the other three unreachable**, tied to the predicate rather than restated.
   * A questionless phase carries a null `currentQuestionId`, and `atLastQuestion` answers
   * `false` for one — so the page cannot ask for `verbsFor("lobby", true)`. If that ever
   * stopped holding, the withholding sweep would be filtering out states that do occur.
   */
  it("cannot reach the last question in a phase that carries none", () => {
    expect(
      atLastQuestion(
        [{ id: "q", kind: "text", prompt: "", scored: true }],
        null,
      ),
    ).toBe(false);
    expect(QUESTIONLESS).toEqual([NO_SESSION, "lobby", "ended"]);
  });

  it("answers every one of them", () => {
    for (const { phase, atLast } of everyDecision()) {
      const decision = verbsFor(phase, atLast);
      expect(decision, label(phase, atLast)).toBeDefined();
      expect(Array.isArray(decision.allow), label(phase, atLast)).toBe(true);
    }
  });
});

describe("the panel never offers a verb the route refuses", () => {
  /**
   * **Risk #1's property, stated as the one-way implication it actually is.** Asserted per
   * phase and position so a failure names the beat rather than reporting `true !== false` —
   * the difference between a red build somebody can act on and one they have to bisect.
   */
  for (const { phase, atLast } of everyDecision()) {
    it(`offers no dead button in ${label(phase, atLast)}`, () => {
      const offered = verbsFor(phase, atLast).allow;

      const dead = offered.filter(
        (action) => routeOutcome(phase, action, atLast) === "refused",
      );

      expect(
        dead,
        `${label(phase, atLast)}: the panel offers ${dead.join(", ")}, which the route answers with 409`,
      ).toEqual([]);
    });
  }
});

describe("every verb the panel withholds from a live route is named", () => {
  /**
   * The other half of the closed set. Computed rather than transcribed, so the expectation
   * cannot drift into agreement with the code by being edited alongside it.
   */
  function materialWithholdingsInDecision(): Omit<Withholding, "reason">[] {
    return reachableDecisions().flatMap(({ phase, atLast }) => {
      const offered = verbsFor(phase, atLast).allow;
      return ACTIONS.filter(
        (action) =>
          !offered.includes(action) &&
          routeOutcome(phase, action, atLast) === "effect",
      ).map((action) => ({ phase, atLast, action }));
    });
  }

  const key = (w: Omit<Withholding, "reason">) =>
    `${w.phase}|${w.atLast}|${w.action}`;

  it("withholds exactly the three that are written down", () => {
    const found = materialWithholdingsInDecision().map(key).sort();
    const declared = MATERIAL_WITHHOLDINGS.map(key).sort();

    // An equality, not a subset: an unlisted withholding is a capability quietly taken away
    // from the host, and a listed one that no longer happens is a stale excuse.
    expect(found).toEqual(declared);
  });

  it("gives each of them a reason", () => {
    expect(MATERIAL_WITHHOLDINGS).toHaveLength(3);
    for (const withholding of MATERIAL_WITHHOLDINGS) {
      expect(withholding.reason.length, key(withholding)).toBeGreaterThan(20);
    }
  });

  /**
   * **A verb withheld where the route does nothing needs no entry**, and this asserts the
   * exemption is real rather than assumed — if these three stopped being no-ops, the test
   * above would start demanding entries for them, which is the correct outcome.
   */
  it("exempts the withholdings where the route would do nothing", () => {
    expect(routeOutcome("lobby", "start", false)).toBe("no-op");
    expect(routeOutcome("question-open", "advance", true)).toBe("no-op");
    expect(routeOutcome("question-revealed", "reveal", false)).toBe("no-op");

    for (const [phase, atLast, action] of [
      ["lobby", false, "start"],
      ["question-open", true, "advance"],
      ["question-revealed", false, "reveal"],
    ] as const) {
      expect(verbsFor(phase, atLast).allow, label(phase, atLast)).not.toContain(
        action,
      );
    }
  });
});

describe("the decision is internally consistent", () => {
  /**
   * **The ring can only sit on a live button.** `syncEndButton` now reads `next` directly
   * instead of recomputing `!disabled && last`, so this invariant is what makes "exactly one
   * filled pill, never a dark one" true by construction rather than by two conditions
   * agreeing.
   */
  it("never rings a verb it has not allowed", () => {
    for (const { phase, atLast } of everyDecision()) {
      const { allow, next } = verbsFor(phase, atLast);
      if (next === null) continue;
      expect(allow, label(phase, atLast)).toContain(next);
    }
  });

  /**
   * **A dark button always says why.** The reason travels on the button itself so a host who
   * reaches for one learns without leaving the panel; a blank `title` is a control that
   * refuses silently in front of the room.
   */
  it("explains every verb it withholds", () => {
    for (const { phase, atLast } of everyDecision()) {
      const { allow, why } = verbsFor(phase, atLast);
      for (const action of ACTIONS) {
        if (allow.includes(action)) continue;
        expect(
          why[action],
          `${label(phase, atLast)}: ${action} is dark with nothing to say`,
        ).toBeTypeOf("string");
      }
    }
  });

  /**
   * **`end` ESCAPES THE LAST-QUESTION COLLAPSE**, and this is the assertion the extraction
   * most needed.
   *
   * The four flow verbs go to an empty `allow` on the last question — `dalej` has nothing to
   * advance to and the closing beat publishes its own board. The closing verb must not follow
   * them: that is precisely the beat where it becomes the only step left. Applying `whenLast`
   * uniformly across all five would disable the one control the host needs on question 14,
   * and before this file existed no test in the project could have noticed.
   */
  it("keeps the closing verb independent of the question's position", () => {
    for (const phase of PHASES) {
      expect(verbsFor(phase, true).allow.includes("end"), phase).toBe(
        verbsFor(phase, false).allow.includes("end"),
      );
    }
  });

  /**
   * The other half of the same rule, from the direction that matters on screen: the ring has
   * to *arrive* on the closing button when the flow verbs empty the bar, or the last beat of
   * the session names no next step at the one moment the host is being watched.
   */
  it("hands the ring to the closing verb once the flow verbs are gone", () => {
    for (const phase of ["question-revealed", "standings"] as const) {
      const last = verbsFor(phase, true);
      expect(last.allow, phase).toEqual(["end"]);
      expect(last.next, phase).toBe("end");

      // …and not before. Mid-quiz the ring belongs to `dalej`.
      expect(verbsFor(phase, false).next, phase).not.toBe("end");
    }
  });

  /** After the close, nothing on the bar works, and the bar says so in words instead. */
  it("offers nothing at all once the session has ended", () => {
    for (const atLast of POSITIONS) {
      expect(verbsFor("ended", atLast).allow, String(atLast)).toEqual([]);
      expect(verbsFor("ended", atLast).next, String(atLast)).toBeNull();
    }
  });

  /**
   * **An unknown phase leaves the panel refusing, not offering.** The phase arrives off the
   * wire, so a document written by a future deploy must not be able to light the bar up. The
   * `Record` makes this unreachable to the type-checker, which is exactly why it needs a
   * runtime assertion.
   */
  it("falls back to the sessionless row for a phase it does not know", () => {
    const unknown = "a-phase-from-the-future" as ControlPhase;
    expect(verbsFor(unknown, false)).toEqual(verbsFor(NO_SESSION, false));
  });
});

/* -------------------------------------------------------------------------- */
/* The two moved predicates                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Question-shaped values rather than questions off the committed quiz, per `src/quiz/CLAUDE.md`'s
 * first fixture rule: neither predicate resolves anything through `getQuestionById`, so nothing
 * here needs a real id. `render.test.ts` is the precedent in this directory, and it is also
 * what keeps a value import from `src/quiz/` out of `src/lib/client/` — legal in a test file
 * today only because `boundary.test.ts` excludes them, which its own note calls provisional.
 */
function question(id: string, kind: PublicQuestion["kind"]): PublicQuestion {
  return { id, kind, prompt: `fixture ${id}`, scored: kind !== "word-cloud" };
}

describe("atLastQuestion", () => {
  const questions = [
    question("fixture-1", "single-choice"),
    question("fixture-2", "text"),
    question("fixture-3", "word-cloud"),
  ];

  it("is true only for the final question", () => {
    expect(atLastQuestion(questions, "fixture-3")).toBe(true);
    expect(atLastQuestion(questions, "fixture-2")).toBe(false);
    expect(atLastQuestion(questions, "fixture-1")).toBe(false);
  });

  it("is false with no current question — that is the lobby, and `ended`", () => {
    expect(atLastQuestion(questions, null)).toBe(false);
  });

  /**
   * **An id this build does not have must not read as the end of the quiz.** `findIndex`
   * answers `-1`, and a rule written as `at === length - 1` alone would be false here by
   * luck rather than by intent — but on a one-question quiz `-1 === 0` is still false while
   * `at >= 0` is what actually states the rule. A snapshot naming a retired question is a
   * real case: the host's tab can outlive a deploy.
   */
  it("is false for an id that is not in the published order", () => {
    expect(atLastQuestion(questions, "fixture-gone")).toBe(false);
    expect(atLastQuestion([question("only", "text")], "fixture-gone")).toBe(
      false,
    );
  });

  it("is false for an empty question list", () => {
    expect(atLastQuestion([], "fixture-1")).toBe(false);
  });
});

describe("pollTargetFor", () => {
  /**
   * **Which kind feeds which panel, stated over the whole kind union.** A `Record` over
   * `PublicQuestion["kind"]` rather than a list of the kinds the quiz happens to contain, so
   * a sixth kind is a type error here rather than a question that silently polls nothing.
   * `host.astro`'s `KIND_LABELS` is held to the same shape for the same reason.
   */
  const KIND_TARGETS: Record<
    PublicQuestion["kind"],
    "participation" | "words" | null
  > = {
    "single-choice": "participation",
    "multiple-choice": "participation",
    /**
     * **The typed kinds count too, and used to not.** The exclusion was the free-text slice's
     * scope clause — written about the *distribution*, which a typed answer genuinely has no
     * shape for — and the count rode along with it. `SUBMIT_ANSWER` has always bumped
     * `answered:<questionId>` for every accepted answer regardless of kind, so this was a
     * figure withheld rather than a figure unavailable, on the two kinds where the host has
     * least else to judge the moment by: typing takes longer than tapping.
     */
    text: "participation",
    number: "participation",
    "word-cloud": "words",
  };

  const questions = (Object.keys(KIND_TARGETS) as PublicQuestion["kind"][]).map(
    (kind) => question(kind, kind),
  );

  const open = (id: string): PollState => ({
    phase: "question-open",
    currentQuestionId: id,
  });
  const revealed = (id: string): PollState => ({
    phase: "question-revealed",
    currentQuestionId: id,
  });

  it("has a row for every kind, so the sweep below is not vacuous", () => {
    expect(questions.length).toBeGreaterThanOrEqual(5);
  });

  it("gives each kind its own panel while the question is open", () => {
    for (const [kind, expected] of Object.entries(KIND_TARGETS)) {
      const target = pollTargetFor(questions, open(kind));
      expect(target?.kind ?? null, kind).toBe(expected);
    }
  });

  /**
   * **The word cloud is the only target that survives the reveal**, so the host keeps a
   * complete cloud to talk over — the reveal closes submissions rather than the panel. The
   * participation count does the opposite: FR-005 keeps the distribution off the screen
   * until the reveal, and the count's own panel goes with the question.
   */
  it("keeps only the word cloud running through the reveal", () => {
    for (const [kind, expected] of Object.entries(KIND_TARGETS)) {
      const target = pollTargetFor(questions, revealed(kind));
      expect(target?.kind ?? null, kind).toBe(
        expected === "words" ? "words" : null,
      );
    }
  });

  /**
   * **The lobby's own target**, which has no panel at all. It exists because a join
   * publishes nothing — 150 joins fanning out to 150 subscribers is the O(N²) shape the
   * spine contract forbids — so `playerCount` moves only on a host action, and the lobby is
   * the one phase where the host acts least and the number changes most.
   *
   * It answers before the question lookup, which is load-bearing: `currentQuestionId` is
   * `null` in the lobby, and a target chosen after that check would never be reached.
   */
  it("polls the open state route in the lobby, with no question", () => {
    const target = pollTargetFor(questions, {
      phase: "lobby",
      currentQuestionId: null,
    });

    expect(target).toEqual({
      kind: "lobby",
      questionId: null,
      url: "/api/quiz/state",
    });
  });

  it("polls nothing in the phases with no panel and no room to count", () => {
    for (const phase of ["standings", "ended"] as const) {
      expect(
        pollTargetFor(questions, { phase, currentQuestionId: "word-cloud" }),
        phase,
      ).toBeNull();
    }
    expect(pollTargetFor(questions, null)).toBeNull();
    expect(
      pollTargetFor(questions, {
        phase: "question-open",
        currentQuestionId: null,
      }),
    ).toBeNull();
  });

  /**
   * A question the published order does not carry has no kind, so it reaches neither
   * branch — the same "fail toward nothing" the predicate gives an unknown phase. A host tab
   * that outlived a deploy polls no endpoint rather than the wrong one.
   */
  it("polls nothing for a question this build does not have", () => {
    expect(pollTargetFor(questions, open("fixture-gone"))).toBeNull();
  });

  it("carries the question id on the url it builds", () => {
    const target = pollTargetFor(questions, open("word-cloud"));

    expect(target?.questionId).toBe("word-cloud");
    expect(target?.url).toContain("/api/quiz/host/words");
    expect(target?.url).toContain(encodeURIComponent("word-cloud"));
  });
});

/**
 * A compile-time echo of the exhaustiveness the `Record`s above buy at runtime: if
 * `SessionPhase` gains a member, `ControlPhase` gains it too, and `ROUTE_OUTCOMES` stops
 * type-checking until somebody decides what the routes do there.
 */
const _phaseUnionIsCovered: Record<SessionPhase, true> = {
  lobby: true,
  "question-open": true,
  "question-revealed": true,
  standings: true,
  ended: true,
};
void _phaseUnionIsCovered;
