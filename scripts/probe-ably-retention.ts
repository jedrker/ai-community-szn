/**
 * Probe for how long Ably retains a published snapshot (roadmap F-03, Phase 1).
 *
 * This is a probe, not shipped behaviour. Nothing under `src/` may import it.
 *
 * ## Why this exists
 *
 * `src/lib/session/realtime.ts` publishes the entire `SessionState` on every host
 * action. Today that state is flow only, but from S-02 it carries attendee display
 * names and from S-03 their answers and scores. Ably retains published messages, and
 * that retention is covered by neither the store's TTL nor `vercel rollback` — so it
 * is a third storage surface under the PRD's retention guardrail, and nobody has ever
 * measured it.
 *
 * F-01 and F-02 both taught this project the same lesson twice: confident vendor
 * documentation is not evidence. `infrastructure.md` was wrong about `fra1` needing
 * Pro and wrong about preview URLs being public, and only a probe caught either. So
 * this measures rather than reads the docs.
 *
 * ## What it measures, and what it deliberately does not
 *
 * The channel *rule* (Ably's per-namespace persistence setting) is configured in the
 * dashboard and readable only through Ably's Control API, which needs a different
 * credential from `ABLY_API_KEY`. This probe therefore measures **behaviour, not
 * configuration**: it publishes a marked message and asks whether it is still
 * retrievable later. That is the property the guardrail actually cares about, and it
 * stays true regardless of which dashboard toggle produced it.
 *
 * ## Why a sibling channel
 *
 * It publishes to `livequiz:probe:retention`, never to the live `livequiz:session`.
 * An Ably namespace is the segment before the first colon, so both channels sit in
 * the `livequiz` namespace and are governed by the same rule — the measurement is
 * honest — but a probe run can never be mistaken for a host action by a device
 * connected to a real session. The live channel is only ever *read* here, never
 * written.
 *
 * Run:
 *   bun scripts/probe-ably-retention.ts                 # measure (default 135s wait)
 *   bun scripts/probe-ably-retention.ts --wait 300      # measure across a longer window
 *   bun scripts/probe-ably-retention.ts --expect-ephemeral
 *       ^ turns the retention reading into a pass/fail assertion. Use this for the
 *         second run, after the channel rule is configured: it is what makes
 *         "persistence is off" a checked claim rather than a believed one.
 *   bun scripts/probe-ably-retention.ts --quick         # skip the wait; live-channel read only
 */

import Ably from "ably";

/**
 * The channel the product actually publishes to. Read-only here — mirrored from
 * `SESSION_CHANNEL` in `src/lib/session/realtime.ts` rather than imported, because a
 * probe must not depend on shipped modules (and `src/lib/session/*` reads
 * `import.meta.env`, which is unpopulated under bare `bun`).
 */
const LIVE_CHANNEL = "livequiz:session";

/** Same namespace, therefore the same rule — but never a live room. */
const PROBE_CHANNEL = "livequiz:probe:retention";

/**
 * Ably's documented ephemeral window — messages stay retrievable this long for
 * connection recovery even with persistence off. A "still there" reading only means
 * anything once the wait has crossed it.
 *
 * Measured 2026-08-06: gone by 135s, still present at 60s. So the real boundary on
 * this app sits between the two, consistent with this figure.
 */
const EPHEMERAL_WINDOW_SECONDS = 120;

/** Crosses `EPHEMERAL_WINDOW_SECONDS` with margin. */
const DEFAULT_WAIT_SECONDS = 135;

/**
 * Ably persists asynchronously, so a history read immediately after a publish can
 * legitimately miss the message. Poll rather than concluding "not retained" from a
 * single miss — that false negative would read as good news, which is the worst
 * direction for a measurement error to point.
 */
const APPEAR_TIMEOUT_SECONDS = 20;
const APPEAR_POLL_MS = 1_000;

type Finding = { ok: boolean; label: string; detail: string };

const findings: Finding[] = [];
/** Measurements are not pass/fail. They are what the artifact is written from. */
const observations: string[] = [];

function record(ok: boolean, label: string, detail: string): void {
  findings.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — ${detail}`);
}

function observe(label: string, detail: string): void {
  observations.push(`${label} — ${detail}`);
  console.log(`  ··    ${label} — ${detail}`);
}

/** See `scripts/probe-spine-config.ts` for why this is `process.env`, not `import.meta.env`. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function numericArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProbeMessage = {
  /** Marks this as a probe so anything reading history knows it is not a snapshot. */
  probe: "f03-ably-retention";
  note: string;
  stamp: number;
};

/**
 * Reads history and returns the probe message with this stamp, if present.
 *
 * `direction: "backwards"` is the default and the useful one — the probe message is
 * the most recent thing on a channel nothing else writes to.
 */
async function findProbeMessage(
  channel: ReturnType<Ably.Rest["channels"]["get"]>,
  stamp: number
): Promise<{ found: boolean; ageSeconds: number | null; total: number }> {
  const page = await channel.history({ limit: 100 });
  const items = page.items;

  const match = items.find((message) => {
    const data = message.data as Partial<ProbeMessage> | undefined;
    return data?.probe === "f03-ably-retention" && data.stamp === stamp;
  });

  return {
    found: Boolean(match),
    ageSeconds: match?.timestamp ? Math.round((Date.now() - match.timestamp) / 1000) : null,
    total: items.length,
  };
}

/**
 * The live channel, read but never written. If this shows retained messages right
 * now, that is not a hypothetical exposure — it is the current one, and from S-02 it
 * would be display names.
 */
async function surveyLiveChannel(rest: Ably.Rest): Promise<void> {
  try {
    const page = await rest.channels.get(LIVE_CHANNEL).history({ limit: 100 });
    const items = page.items;

    if (items.length === 0) {
      observe(`live channel ${LIVE_CHANNEL}`, "no retrievable history right now");
      return;
    }

    const oldest = items[items.length - 1]!;
    const newest = items[0]!;
    const oldestAge = Math.round((Date.now() - oldest.timestamp) / 1000);
    const newestAge = Math.round((Date.now() - newest.timestamp) / 1000);

    observe(
      `live channel ${LIVE_CHANNEL}`,
      `${items.length} message(s) retrievable, oldest ${oldestAge}s old, newest ${newestAge}s old`
    );
    console.log(
      "\n  → Those are real published snapshots, still readable by anything holding a\n" +
        "    subscribe token. Today they carry flow only. From S-02 they carry display\n" +
        "    names, and from S-03 answers and scores.\n"
    );
  } catch (err) {
    record(
      false,
      `reading history on ${LIVE_CHANNEL}`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function probeRetention(rest: Ably.Rest, waitSeconds: number): Promise<void> {
  const channel = rest.channels.get(PROBE_CHANNEL);
  const stamp = Date.now();

  const payload: ProbeMessage = {
    probe: "f03-ably-retention",
    note: "F-03 retention probe. Not a session snapshot. Safe to ignore and safe to delete.",
    stamp,
  };

  try {
    // Deliberately NOT the "snapshot" event name the product publishes under, so even
    // a client subscribed to this namespace by mistake would not process it.
    await channel.publish("probe", payload);
    record(true, "published a marked probe message", `stamp=${stamp} on ${PROBE_CHANNEL}`);
  } catch (err) {
    record(
      false,
      "publishing to the probe channel",
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  // Appearance check. A miss here is a measurement failure, not a retention finding.
  let appeared = false;
  const deadline = Date.now() + APPEAR_TIMEOUT_SECONDS * 1_000;

  while (Date.now() < deadline) {
    const result = await findProbeMessage(channel, stamp);
    if (result.found) {
      appeared = true;
      record(true, "message is retrievable from history after publish", `age ${result.ageSeconds}s`);
      break;
    }
    await sleep(APPEAR_POLL_MS);
  }

  if (!appeared) {
    record(
      false,
      "message is retrievable from history after publish",
      `not found within ${APPEAR_TIMEOUT_SECONDS}s — cannot measure retention from here`
    );
    console.log(
      "\n  → A message that never appears in history is either a publish that did not\n" +
        "    land or a channel with history fully disabled. Check the Ably dashboard\n" +
        "    before recording this as 'retention is zero' — the two look identical here.\n"
    );
    return;
  }

  if (waitSeconds <= 0) {
    observe("retention window", "not measured (--quick)");
    return;
  }

  console.log(
    `\n  Waiting ${waitSeconds}s to see whether the message outlives the ephemeral window…\n`
  );
  await sleep(waitSeconds * 1_000);

  const after = await findProbeMessage(channel, stamp);
  const expectEphemeral = flag("expect-ephemeral");

  if (after.found) {
    // Crossing the ephemeral window is what makes "still there" mean anything. Below
    // it, survival is the documented behaviour even with persistence fully off, so
    // reading it as evidence of persistence would be a false alarm — and a
    // `--expect-ephemeral` run would fail for no reason.
    if (waitSeconds < EPHEMERAL_WINDOW_SECONDS) {
      observe(
        "retention window",
        `still retrievable after ${after.ageSeconds}s — INCONCLUSIVE: the wait did not ` +
          `cross the ~${EPHEMERAL_WINDOW_SECONDS}s ephemeral window, where survival is expected ` +
          "regardless of the persistence setting"
      );
      console.log(
        `\n  → Re-run with --wait ${DEFAULT_WAIT_SECONDS} or higher to get a reading that\n` +
          "    distinguishes the ephemeral default from real persistence.\n"
      );
      return;
    }

    const detail =
      `still retrievable after ${after.ageSeconds}s — retention EXCEEDS the ` +
      `~${EPHEMERAL_WINDOW_SECONDS}s ephemeral window, so persistence is on for this namespace`;

    if (expectEphemeral) {
      record(false, "retention window", detail);
      console.log(
        "\n  → Asserted ephemeral, measured persistent. Either the channel rule did not\n" +
          "    take effect, or it does not cover this namespace. Do not record the\n" +
          "    guardrail as closed on this surface.\n"
      );
    } else {
      observe("retention window", detail);
    }
    return;
  }

  const detail =
    `gone after ~${waitSeconds}s — retention is at or below the ~${EPHEMERAL_WINDOW_SECONDS}s ` +
    "ephemeral window, so a published snapshot is not durably stored";

  if (expectEphemeral) {
    record(true, "retention window", detail);
  } else {
    observe("retention window", detail);
  }
}

async function main(): Promise<void> {
  const waitSeconds = flag("quick") ? 0 : numericArg("wait", DEFAULT_WAIT_SECONDS);

  console.log("\nProbing Ably message retention (F-03 Phase 1).\n");
  console.log(
    `  mode: ${flag("expect-ephemeral") ? "ASSERT ephemeral" : "measure"}, ` +
      `wait: ${waitSeconds === 0 ? "skipped" : `${waitSeconds}s`}\n`
  );

  // Refuse an assertion the wait cannot support, rather than letting it pass
  // vacuously. A green `--expect-ephemeral` run is meant to be evidence; one that
  // could not have failed is worse than no run at all.
  if (flag("expect-ephemeral") && waitSeconds < EPHEMERAL_WINDOW_SECONDS) {
    console.error(
      `  --expect-ephemeral needs --wait >= ${EPHEMERAL_WINDOW_SECONDS} (got ` +
        `${waitSeconds === 0 ? "--quick" : `${waitSeconds}s`}).\n\n` +
        `  Below the ~${EPHEMERAL_WINDOW_SECONDS}s ephemeral window a message survives whether or\n` +
        "  not persistence is on, so the assertion would pass without proving anything.\n"
    );
    process.exit(1);
  }

  const apiKey = env("ABLY_API_KEY");
  record(Boolean(apiKey), "env ABLY_API_KEY", apiKey ? "present" : "absent");

  if (!apiKey) {
    console.log(
      "\n  → Pull it locally (`vercel env pull`) or export it by hand, then re-run.\n"
    );
    process.exit(1);
  }

  const rest = new Ably.Rest({ key: apiKey });

  await surveyLiveChannel(rest);
  await probeRetention(rest, waitSeconds);

  const failed = findings.filter((finding) => !finding.ok);

  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed.`);

  if (observations.length > 0) {
    console.log("\nObservations (these are what the artifact is written from):");
    for (const observation of observations) console.log(`  - ${observation}`);
  }

  console.log("");

  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const finding of failed) console.log(`  - ${finding.label}`);
    console.log("");
    process.exit(1);
  }

  console.log(
    "Record the measured window in\n" +
      "context/changes/session-end-and-data-purge/ably-retention-probe.md, then configure\n" +
      "the livequiz:* channel rule and re-run with --expect-ephemeral.\n"
  );
}

main().catch((err) => {
  console.error("\nProbe crashed:", err);
  process.exit(1);
});
