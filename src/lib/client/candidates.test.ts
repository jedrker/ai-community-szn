import { describe, expect, it } from "vitest";

import type { PublicQuestion } from "../../quiz/public";
import { SESSION_PHASES, type SessionState } from "../session/state";
import {
  addCandidate,
  candidateListProblem,
  candidatesEditable,
  nextCandidate,
  removeCandidate,
  renameCandidate,
  resizeCandidates,
  withCandidates,
  type Candidate,
  type CandidateLimits,
} from "./candidates";

const limits: CandidateLimits = { min: 2, max: 6, textLength: 10 };

function demos(...ns: number[]): Candidate[] {
  return ns.map((n) => ({ id: `demo-${n}`, text: `Demo ${n}` }));
}

const NOW = 1_785_000_000_000;

function stateIn(
  phase: SessionState["phase"],
  candidates: SessionState["candidates"] = {},
): SessionState {
  return {
    version: 3,
    phase,
    quizId: "fixture-quiz",
    candidates,
    currentQuestionId:
      phase === "lobby" || phase === "ended" ? null : "fixture-vote",
    startedAt: NOW,
    updatedAt: NOW,
    playerCount: 0,
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
  };
}

const voteQuestion: PublicQuestion = {
  id: "fixture-vote",
  kind: "vote",
  prompt: "Który?",
  scored: false,
  options: demos(1, 2),
};

describe("candidatesEditable", () => {
  it("is true in the lobby and nowhere else, including with no session", () => {
    for (const phase of SESSION_PHASES) {
      expect(candidatesEditable(stateIn(phase))).toBe(phase === "lobby");
    }
    expect(candidatesEditable(null)).toBe(false);
  });
});

describe("withCandidates", () => {
  it("overlays the session's list onto the question it is keyed by", () => {
    const list = demos(7, 8, 9);
    const state = stateIn("lobby", { "fixture-vote": list });

    expect(withCandidates(voteQuestion, state).options).toBe(list);
    expect(withCandidates(voteQuestion, state).id).toBe(voteQuestion.id);
  });

  it("returns the same object when the session set no list for it", () => {
    const state = stateIn("lobby", { "fixture-other": demos(7) });

    expect(withCandidates(voteQuestion, state)).toBe(voteQuestion);
    expect(withCandidates(voteQuestion, null)).toBe(voteQuestion);
  });

  it("passes an absent question through", () => {
    expect(withCandidates(undefined, stateIn("lobby"))).toBeUndefined();
  });
});

describe("nextCandidate", () => {
  it("starts at demo-1 on an empty list", () => {
    expect(nextCandidate([])).toEqual({ id: "demo-1", text: "Demo 1" });
  });

  it("goes one past the highest demo number, not the length", () => {
    expect(nextCandidate(demos(1, 3))).toEqual({
      id: "demo-4",
      text: "Demo 4",
    });
  });

  it("ignores ids that are not demo-N", () => {
    expect(
      nextCandidate([{ id: "cursor", text: "Cursor" }, ...demos(2)]),
    ).toEqual({ id: "demo-3", text: "Demo 3" });
  });
});

describe("addCandidate and removeCandidate", () => {
  it("appends the next demo row", () => {
    expect(addCandidate(demos(1, 2), limits)).toEqual(demos(1, 2, 3));
  });

  it("returns the list itself at the maximum", () => {
    const full = demos(1, 2, 3, 4, 5, 6);
    expect(addCandidate(full, limits)).toBe(full);
  });

  it("drops the named row", () => {
    expect(removeCandidate(demos(1, 2, 3), "demo-2", limits)).toEqual(
      demos(1, 3),
    );
  });

  it("returns the list itself at the minimum or for an unknown id", () => {
    const two = demos(1, 2);
    expect(removeCandidate(two, "demo-1", limits)).toBe(two);
    const three = demos(1, 2, 3);
    expect(removeCandidate(three, "demo-9", limits)).toBe(three);
  });
});

describe("renameCandidate", () => {
  it("replaces the text of the named row only", () => {
    expect(renameCandidate(demos(1, 2), "demo-1", "Cursor")).toEqual([
      { id: "demo-1", text: "Cursor" },
      { id: "demo-2", text: "Demo 2" },
    ]);
  });
});

describe("resizeCandidates", () => {
  it("grows with fresh demo rows", () => {
    expect(resizeCandidates(demos(1, 2, 3, 4), 6, limits)).toEqual(
      demos(1, 2, 3, 4, 5, 6),
    );
  });

  it("shrinks from the end", () => {
    expect(resizeCandidates(demos(1, 2, 3, 4), 3, limits)).toEqual(
      demos(1, 2, 3),
    );
  });

  it("clamps to the bounds", () => {
    expect(resizeCandidates(demos(1, 2, 3, 4), 1, limits)).toEqual(demos(1, 2));
    expect(resizeCandidates(demos(1, 2), 40, limits)).toHaveLength(limits.max);
    expect(resizeCandidates(demos(1, 2, 3), Number.NaN, limits)).toEqual(
      demos(1, 2),
    );
  });
});

describe("candidateListProblem", () => {
  it("is null for a list the server would accept", () => {
    expect(candidateListProblem(demos(1, 2), limits)).toBeNull();
  });

  it("names an empty name first, even one made of spaces", () => {
    expect(candidateListProblem([{ id: "demo-1", text: "  " }], limits)).toBe(
      "Nazwa uczestnika nie może być pusta.",
    );
  });

  it("names a name past the length", () => {
    expect(
      candidateListProblem(
        [
          { id: "demo-1", text: "x".repeat(limits.textLength + 1) },
          ...demos(2),
        ],
        limits,
      ),
    ).toBe(`Nazwa uczestnika ma najwyżej ${limits.textLength} znaków.`);
  });

  it("names a list outside the size bounds", () => {
    expect(candidateListProblem(demos(1), limits)).toBe(
      `Lista musi mieć od ${limits.min} do ${limits.max} uczestników.`,
    );
  });
});
