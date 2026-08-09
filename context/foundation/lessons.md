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
