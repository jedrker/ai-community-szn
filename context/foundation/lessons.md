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
