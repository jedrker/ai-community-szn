# `change.md` Reference

Each `context/changes/<change-id>/change.md` is the change's lifecycle identity file. Tiny — frontmatter + an optional `## Notes` body.

## File shape

```markdown
---
change_id: <kebab-case-id> # required, must match folder name
title: <human-readable title> # required
status: <status> # required, see allowed values below
created: YYYY-MM-DD # required, set at /10x-new time
updated: YYYY-MM-DD # required, last lifecycle skill write
archived_at: <iso-datetime> # null until /10x-archive runs
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->
```

## Allowed `status` values

`new`, `preparing`, `planned`, `plan_reviewed`, `implementing`, `implemented`, `impl_reviewed`, `archived`, `blocked`

### Transitions

| From            | To              | Triggered by                                         |
| --------------- | --------------- | ---------------------------------------------------- |
| (none)          | `new`           | `/10x-new`                                           |
| `new`           | `preparing`     | first of `/10x-research` or `/10x-frame`             |
| `preparing`     | `planned`       | `/10x-plan`                                          |
| `new`           | `planned`       | `/10x-plan` (when research/frame skipped)            |
| `planned`       | `plan_reviewed` | `/10x-plan-review`                                   |
| `plan_reviewed` | `implementing`  | `/10x-implement` (first phase)                       |
| `planned`       | `implementing`  | `/10x-implement` (when plan-review skipped)          |
| `implementing`  | `implemented`   | `/10x-implement` (last phase complete)               |
| `implemented`   | `impl_reviewed` | `/10x-impl-review`                                   |
| `implementing`  | `impl_reviewed` | `/10x-impl-review` (when running mid-implementation) |
| any             | `blocked`       | manual (user edit)                                   |
| `blocked`       | previous        | manual (user edit)                                   |
| `impl_reviewed` | `archived`      | `/10x-archive`                                       |
| `implemented`   | `archived`      | `/10x-archive` (when impl-review skipped)            |

## Update semantics

Skills update `change.md` on every lifecycle-changing run (`status`, `updated`). The file is record-only — nothing enforces transition rules. Skipping a step is allowed; `/10x-status` will surface gaps via missing artifact files (e.g., "status=plan_reviewed but no reviews/plan-review.md").

## What is NOT in change.md

By design:

- No `artifacts.*` block — derive from `ls` of the change folder.
- No `implementation.{total_phases,completed_phases,current_phase}` — derive from the `## Progress` section in `plan.md`.
- No `requires` / `blocked_by` — out of scope.
