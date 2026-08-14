# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Check the data path can deliver a promised UI affordance

- **Context**: Planning and implementing any phase whose plan promises a UI affordance — a refresh button, a live count, a progress indicator — *and* separately specifies when the underlying data is written. The conflict lives in the gap between those two statements, so it appears in plans that are individually precise about both.
- **Problem**: S-02's plan asserted both "the join count is embedded at host-action time" and "the refresh is how the host watches the lobby fill". Those cannot both hold — refresh re-read a document whose count only a host action could change — and the implementation followed the data rule, silently defeating the affordance. Tests were green, type-check was clean, and it surfaced only in a live two-device run against production.
- **Rule**: When a plan promises a UI affordance, trace the data path end to end and confirm it can actually deliver it before implementing. Where a plan states both an affordance and a write/refresh rule, check the two are consistent — if they conflict, raise it rather than implementing one and letting the other quietly fail.
- **Applies to**: plan, plan-review, implement, impl-review

## Absent untrusted input must fail toward the safe end, not the favourable one

- **Context**: Any request path that reads a client-supplied number, timestamp or flag and then
  clamps or validates it. The guard is usually written for the *hostile* value — a device that lies —
  and the absent value silently takes a different path through the same code.
- **Problem**: S-03 read the attendee's elapsed time as `Number(form.get("elapsedMs"))`. `Number(null)`
  is `0`, not `NaN`, so a submission that simply omitted the field scored as an instant answer and
  took full speed weight. The clamp's `NaN` guard never fired. The accepted, documented risk was a
  device *claiming* zero; a device saying nothing getting the same reward was not considered, and it
  would have been the default for any client that forgot the field — including a future one written
  against this route. Caught only because a test asserted the *value* of the award for a formless
  submission rather than that the request was accepted.
- **Rule**: For every untrusted field, decide what "said nothing" means before deciding what "lied"
  means, and make the absent case fail toward the conservative end. Prefer parsing the field
  explicitly (`typeof x === "string" && x.length > 0 ? Number(x) : NaN`) over a bare coercion whose
  behaviour on `null`, `""` and `[]` differs from its behaviour on garbage. Assert the outcome for the
  absent case in a test, not just the rejection for the hostile one.
- **Applies to**: plan, implement, impl-review

## Grep every caller before editing a shared pure function

- **Context**: Any change that modifies a shared pure function in place — normalization, folding,
  hashing, formatting, comparison — rather than adding one beside it. Sharpest when the function's
  output is used as a storage key or an identity.
- **Problem**: S-05's plan widened `normalizePolish` to fold trailing punctuation for answer
  matching, naming `src/quiz/schema.ts:128` as its only other caller.
  `src/lib/session/players.ts:100` uses the same function as the display-name claim key, and `.` is a
  legal name character — so the change would have merged `"Ania."` and `"Ania"` into one claim and,
  mid-deploy, let two visually identical names onto the leaderboard, because the stored keys in
  `livequiz:players` were written with the old fold. Caught in plan review, not by a test.
- **Rule**: Before changing a shared pure function, grep every non-test caller and name what each one
  uses the output FOR. A fold used as an identity or storage key is not the same function as a fold
  used for comparison, even when the code is identical — widen it beside, not in place. Pin the
  original's behaviour with a test so a later edit cannot quietly recombine them.
- **Applies to**: plan, plan-review, implement, impl-review

## Prove the fixture reaches the branch the test names

- **Context**: Any test written for a *specific* branch — an absent or hostile input, a
  skip path, an error path — where the fixture comes from a destructuring default, a
  spread of a shared base object, or an index into real project data (`questions[0]`,
  the first row of a seed file). Sharpest when one fixture is shared across a file, so
  the branch a given test reaches is decided somewhere other than the test.
- **Problem**: S-04 shipped two of these in one session, both green. A route test passed
  `questionId: undefined` for the "parameter absent" case; the helper's destructuring
  default replaced it with the valid id, so the test exercised the *present* case and
  would have passed against a route with no guard at all — the exact input class
  `lessons.md` already has an entry about, defeated by the test helper rather than by
  the code. A reveal test built its fixture from `quiz.questions[0]`, which is the
  word-cloud opener, so every distribution assertion ran through the non-choice *skip*
  branch while reading as though it covered the tally read. In both, the assertion was
  right and the fixture pointed it at the wrong branch; a passing suite was evidence of
  nothing.
- **Rule**: For any test that names a specific branch, prove the fixture reaches it —
  assert something only that branch produces, or verify the test fails when the branch
  is removed. Never spell an absent value as `undefined` where a default can silently
  replace it, and never build a branch-specific fixture from a shared base or a
  positional index into real data without checking what that datum actually is.
- **Applies to**: plan, plan-review, implement, impl-review

## In a timer or async test, the fixture's *timing* decides the branch

- **Context**: Any test of a loop, retry, debounce, backoff, in-flight guard or cleanup path
  that uses fake timers and a stubbed async dependency. The entry above covers fixtures whose
  *values* are silently replaced; this is the same failure through a different door — the
  values are right and the **schedule** points the test at another branch. Sharpest for any
  test whose name contains "while", "during" or "mid-", because those words are claims about
  overlap in time and nothing in the test enforces them.
- **Problem**: The `connection-limit-degradation` fallback loop shipped two of these in one
  session, both green, and the second hid a real defect. (1) The tests advanced fake time by
  the loop's *widest* jittered interval, on the assumption that one advance is one tick. Fake
  time is a single continuous line, so the unused remainder of each advance accumulates and
  eventually pays for an extra tick — tick counts drifted upward by one around the third
  advance, and the first fix attempted was to the code. (2) The stubbed `refresh` returned
  `Promise.resolve()`, so advancing time ran the tick *and* its `finally` before the next line
  of the test. A test named "stops re-arming once the session has ended **mid-flight**", with a
  comment about the `finally` guard, therefore only ever reached the *fire-time* guard: no
  request was ever open across an assertion anywhere in the file. That is precisely why the
  suite could not see that `stop()` was undone by the `finally` of a request it never knew
  about — a cancel that silently restarted the loop, found by review rather than by tests.
- **Rule**: Make time and settlement explicit rather than approximate. Pin the source of
  interval randomness so one advance is exactly one tick, and give the jitter or backoff its
  own timing test instead of smuggling it into every other assertion. When a test names an
  overlap — "during", "while in flight", "mid-request" — hold the promise open with a manually
  resolved deferred and settle it inside the test; a stub that resolves immediately cannot
  produce the state such a test claims to exercise. Then verify by breaking the guard: revert
  it and watch that specific test fail. Naming a timing branch is not reaching it.
- **Applies to**: plan, plan-review, implement, impl-review

## Check every path that emits a shared document, not just the one you reasoned about

- **Context**: Any change that adds a field to a document more than one surface emits — a
  broadcast snapshot, a shared response body, a cached payload. Sharpest when one of those
  surfaces is deliberately unauthenticated and its openness was justified by what the payload
  used to contain.
- **Problem**: S-07 added `standings` — the first attendee display names ever published — to
  `SessionState`, and the whole retention argument covered only Ably's ~120s connection-recovery
  window. `GET /api/quiz/state` is deliberately open and returns the same document; its own
  justification, "it returns exactly what is already broadcast", was written when that document
  held nothing but a count. The names were therefore readable by anyone with the attendee URL
  for as long as the host left the board up — a different mechanism and a longer window than the
  one the plan analysed — while the PRD still asserted "no display name is ever published".
  Neither tests nor `astro check` can see this; implementation review caught it.
- **Rule**: Before adding a field to a shared document, list every route and transport that emits
  it and re-check each one's access justification against the new payload. A justification of the
  form "this only returns what X already exposes" is invalidated by any change to X — re-derive
  it, never inherit it. Amend the documents that state the old guarantee in the same change, and
  state the binding exposure rather than the first one you thought of.
- **Applies to**: plan, plan-review, implement, impl-review

## Break the guard and watch the named test fail — routinely, not when it looks interesting

- **Context**: Every test written for a guard, branch or invariant, and every fix applied during
  review triage. Sharpest immediately after the two entries above have already been read — both
  name this technique as an option, and it is precisely the step that gets skipped when the
  fixture looks obviously fine.
- **Problem**: S-07 shipped two tests that could not fail, neither of them the shape the entries
  above describe — no destructuring default, no shared base object, no fake timers. (1) "paints
  rows in the order given and never sorts them" used a fixture already in descending points
  order, so injecting a sort into `renderStandings` changed nothing; it shipped in a commit whose
  message claimed it covered the no-divergence guardrail. (2) A triage fix for an impl-review
  finding was aimed at the wrong mechanism — corrupt *scores* rather than dropped *player
  records* — and its test passed with the fix reverted; the finding had already been reported as
  fixed before a regression run showed otherwise. Both were found only by deliberately breaking
  the code, and one of them only after it had been committed and described as done.
- **Rule**: After writing a test for a guard, revert or disable that guard, confirm that specific
  test fails, then restore. Treat it as a routine step in the same edit, not a flourish reserved
  for interesting branches. If no edit to the code under test can make the test fail, stop: either
  the fixture cannot reach the branch, or the change is behaviour-neutral — in which case say so
  plainly instead of reporting it as a fix.
- **Applies to**: implement, impl-review

## A source-scanning guard must assert the property, not the shape — and be verified both ways

- **Context**: Any test that asserts a property by scanning source text rather than executing it —
  `src/pages/quiz/host.test.ts`, `keys.test.ts`, `boundary.test.ts`, `participation.test.ts`'s and
  `words.test.ts`'s writes-nothing scans. These exist because the thing under test has no harness (an
  Astro inline script) or because the property is about what code *can* reach rather than what it does.
- **Problem**: A scan for an expression that exists today certifies whatever is there, defects
  included. S-08's `host.test.ts` asserted `client.current()?.phase === "question-revealed"` — the
  arrival-phase form, which *was* the defect: it passed for four commits and failed only when the bug
  was fixed, at which point the tempting move is to "fix the test" back toward the bug. A second
  assertion pinned a *name* (`let pollTimer` occurring once) and stayed true when `let cloudTimer` was
  declared beside it. Two more counted an occurrence file-wide and so failed on *correct* code, because
  the predicate legitimately states its condition twice and `resetPanels` legitimately clears the same
  flag. Four instances in one change, one of them in a guard written specifically to catch regressions.
- **Rule**: A guard must assert the property, never the code's current shape — a scan for an expression
  that exists today certifies whatever is there, defects included. Verify every guard in both
  directions: confirm it passes on the correct code AND fails when the code is broken. A guard that
  only ever ran against one of the two has been checked, not verified.
- **Applies to**: implement, impl-review
