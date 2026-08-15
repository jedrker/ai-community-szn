---
change_id: livequiz-signage-redesign
title: Restyle the LiveQuiz host and attendee views to the signage design
status: implemented
created: 2026-08-15
updated: 2026-08-15
archived_at: null
---

## Status

All eleven plan steps are implemented and verified — see `verification.md` for what the
final pass covered and, more usefully, what it could not.

## What this is

A visual redesign of the two LiveQuiz views — `/quiz/host` (projector) and `/quiz`
(attendee phone) — from the current purple-on-near-black SaaS look to a "signage"
system: ink ground, chrome-yellow accent, Swiss-editorial type at projector scale.

**Presentation only.** No route, schema, session-key, scoring or state-machine change.
The one exception is `say()` in `host.astro`, which needs a third message register — see
plan step 6.

## Where the design lives

Paper file **"Motivated honey"** — https://app.paper.design/file/01M00ZJRWQXY7P4MKPA2JY42F7/1-0

31 artboards: 11 projector (1920×1080) and 20 phone (390×844), named `Host — …` and
`Gracz — …`. All copy in the artboards is quoted verbatim from the code, so a string in
Paper that disagrees with the source is a bug in the artboard, not a copy change to make.

`plan.md` carries the full token set and per-component measurements, so **the plan is
executable without opening Paper.** Open Paper only to check a layout you cannot picture.

## Why

The current views were built for legibility from the back of a room but never given a
visual system: three equal-weight metrics, 18px labels over numbers, an undifferentiated
row of purple buttons, and no visual distinction between question kinds or between the
three things a host message can mean. The redesign gives the projector a single focal
point per phase and gives the panel a next-step affordance.
