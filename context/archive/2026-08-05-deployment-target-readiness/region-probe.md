# Region probe — what the Hobby plan does with `vercel.json` `regions`

Phase 2 artifact for change `deployment-target-readiness` (roadmap F-01).
Purpose: record, as observed fact rather than assumption, what happens when `vercel.json` declares
`regions: ["fra1"]` while the project is on the **Vercel Hobby** plan — and crucially **why**, since an
"ignored" result has two causes that lead to opposite actions.

- **Date**: 2026-08-06
- **Plan at time of probe**: Hobby (team `jedrkers-projects`, project `ai-community-szn`)
- **Adapter**: `@astrojs/vercel` 10.0.8 (Astro 6.4.8)
- **Config under test**: `vercel.json` → `{ "framework": "astro", "regions": ["fra1"] }`
- **Probe deployment**: `https://ai-community-5v0se15yi-jedrkers-projects.vercel.app`
  (`dpl_4Ya4DKkt6AXnHfZ16SeUdwaDz2kr`, target **preview**, status Ready)

## Outcome: HONOURED

**The Hobby plan honours the key.** `vercel inspect` on the probe deployment reports the function's
region directly:

```
Builds
  ┌ .        [0ms]
  └── λ _render (15.61MB) [fra1]
```

This contradicts `context/foundation/infrastructure.md`, which states *"Hobby is single-region (`iad1`,
US East) with region selection reserved for Pro and above."* On the evidence here that claim is wrong
(or has been outdated by a platform change). **This is a research error, not a consequence of the
Hobby decision** — and it is corrected in Phase 3's amendment.

### Controlled comparison

The same project, same adapter, two deployments differing only in the presence of the `regions` key:

| Deployment | `regions` key | Function region | Evidence |
| --- | --- | --- | --- |
| Preview `5v0se15yi` (this probe) | present | **`fra1`** | `vercel inspect` → `λ _render … [fra1]` |
| Production `72a23gk7q` (2h earlier) | absent | **`iad1`** | runtime header `x-vercel-id: arn1::iad1::…` |

The runtime header format is `<edge-region>::<function-region>::<id>`. Production, which predates this
change, executes functions in `iad1` — so `iad1` was indeed the default, but it was a *default*, not a
plan-enforced ceiling.

## Cause analysis

An **ignored** result would have had two possible causes, requiring opposite responses:

1. the **Hobby plan** restricting region selection (a Pro upgrade would fix it), or
2. the **adapter** emitting its own per-function config without a region, so the platform never
   consults `vercel.json`'s top-level key (a Pro upgrade would *not* fix it).

Neither applies, because the result was not "ignored". Cause 2 was independently ruled out against the
local build output before deploying:

```bash
bun run build
find .vercel/output/functions -name '.vc-config.json' -exec grep -l -i region {} +
# → no matches
```

The adapter produces one function, `_render.func`, whose `.vc-config.json` is:

```json
{
  "runtime": "nodejs22.x",
  "handler": "dist/server/entry.mjs",
  "launcherType": "Nodejs",
  "supportsResponseStreaming": true
}
```

No `region` / `regions` field, and none in the generated top-level `.vercel/output/config.json` either.
So `vercel.json`'s key is the only region declaration in play — which is exactly why it takes effect.

## Consequences

- **The key stays in `vercel.json`.** No conditional revert. It is not merely valid config awaiting a
  paid plan; it is *live* config that already works.
- **F-01 delivers the EU region after all.** This was one of the two outcomes assumed unreachable on
  Hobby. Only **log retention** (one hour) remains a genuine Hobby gap.
- **F-04 will measure from `fra1`, not `iad1`** — once the key reaches production. This substantially
  defuses the latency leg of the upgrade tripwire: the transatlantic round trip that motivated it is
  gone.
- **Production is still `iad1` until this change lands on `main`.** The key only affects deployments
  built after it exists. Any latency measured against production before that merge is measuring the old
  region and must not be recorded as the project's baseline.

## Side finding: preview deployments are NOT publicly reachable

`infrastructure.md` §Operational Story states *"Preview URLs are publicly reachable by default."* Not
true for this project — deployment protection (Vercel Authentication) is enabled. Every anonymous
request to the probe URL returns `302` to `https://vercel.com/sso-api?...`:

```
$ curl -sI https://ai-community-5v0se15yi-jedrkers-projects.vercel.app/
location: https://vercel.com/sso-api?url=…&nonce=…
```

No function executes on those requests — the protection layer answers first, which is why the probe's
`x-vercel-id` carries no function-region segment while production's does.

Two implications worth carrying forward:

- Verifying that a preview *renders* requires an authenticated browser session or a protection-bypass
  token; it cannot be checked with an anonymous `curl`.
- This materially improves the PRD's recorded concern about an unprotected host view: a preview of the
  quiz host view would **not** be publicly reachable as `infrastructure.md` feared. The production host
  view is a separate question and remains unprotected.

## Commands run

```bash
bun -e 'JSON.parse(require("fs").readFileSync("vercel.json","utf8"))'   # valid JSON
bun run build                                                           # succeeds with the key
find .vercel/output/functions -name '.vc-config.json' -exec grep -l -i region {} +
vercel login && vercel link --project ai-community-szn --yes             # human-authenticated
vercel deploy                                                           # PREVIEW only, never --prod
vercel inspect ai-community-5v0se15yi-jedrkers-projects.vercel.app
curl -sI <preview>/ ; curl -sI https://ai-community-szn.vercel.app/      # region + protection evidence
```

Note: the first `vercel deploy` attempt failed with `Error: Upload aborted` while uploading a 243.7MB
payload (`public/photos` alone is 122MB). A plain retry succeeded. Worth knowing before an event — a
CLI deploy from this repo moves a quarter of a gigabyte and can fail transiently; the git-push path
does not have this problem.
