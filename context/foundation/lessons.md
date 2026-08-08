# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Check the data path can deliver a promised UI affordance

- **Context**: Planning and implementing any phase whose plan promises a UI affordance — a refresh button, a live count, a progress indicator — *and* separately specifies when the underlying data is written. The conflict lives in the gap between those two statements, so it appears in plans that are individually precise about both.
- **Problem**: S-02's plan asserted both "the join count is embedded at host-action time" and "the refresh is how the host watches the lobby fill". Those cannot both hold — refresh re-read a document whose count only a host action could change — and the implementation followed the data rule, silently defeating the affordance. Tests were green, type-check was clean, and it surfaced only in a live two-device run against production.
- **Rule**: When a plan promises a UI affordance, trace the data path end to end and confirm it can actually deliver it before implementing. Where a plan states both an affordance and a write/refresh rule, check the two are consistent — if they conflict, raise it rather than implementing one and letting the other quietly fail.
- **Applies to**: plan, plan-review, implement, impl-review
