/**
 * The device's own opaque id, in `localStorage` (roadmap S-09, PRD FR-018).
 *
 * The client half of the per-device player cap. The device mints an id about itself on
 * first load and hands the same one back on every later one; the server counts claims
 * against it in the devices hash (`DEVICES_KEY`) and refuses the fourth.
 *
 * The storage key arrives through `define:vars` as an argument, because a client module
 * may not value-import from `src/lib/session/` (`boundary.test.ts`) — the same handoff
 * `player.ts` and `answer.ts` use.
 *
 * ## What this identifies, and what it deliberately does not
 *
 * It says "this browser profile", and it says it only because the browser volunteers it.
 * There is no cookie, no fingerprint and no server-side identity: clearing site data or
 * opening a private tab produces a new device as far as the cap is concerned. That is
 * FR-018's stated shape — a lightweight, defeatable guard rather than an identity
 * system — so the resettability is the design and not a hole in it.
 *
 * ## Why this one always returns a value, unlike `player.ts`
 *
 * `player.ts` reports every storage failure as "no stored player" and lets the attendee
 * type their name again. This module must never report nothing: **the route refuses a
 * claim that carries no device id**, because an absent id treated as un-counted is the
 * cap's bypass, and bucketing every id-less device together would let a handful of
 * private-mode attendees eat the whole room's allowance.
 *
 * So a device whose storage throws gets a fresh id per page load. It is never capped in
 * practice — which is the accepted defeatability again, arriving through a door nobody
 * chose — and, crucially, it can still join. Failing the *guard* open here is right
 * because the alternative fails the *join* closed, and FR-007's thirty seconds is a
 * must-have while FR-018 is explicitly defeatable.
 *
 * Nothing here throws: `player.ts`'s posture, for the same reasons — Safari in private
 * mode throws on write, storage can be disabled outright, and none of that may take a
 * join down.
 */

/**
 * Ids already resolved this page load, keyed by storage key.
 *
 * **Without this, a device whose storage is broken mints a new id on every call**, and
 * two calls inside one load would count as two devices. Nothing calls it twice today;
 * the memo is here so that a second call site is not a silent bug in the cap.
 */
const minted = new Map<string, string>();

/**
 * Whether this device could actually *keep* its id, per storage key.
 *
 * Recorded as a side effect of `deviceId` rather than probed separately, because a probe
 * would have to write a key of its own to find out — and the write it would be imitating
 * is the one happening here anyway.
 *
 * **Its consumer is a piece of copy, and getting the question wrong is what made it
 * necessary** (impl review F1). The join view wants to explain a `taken` refusal to
 * someone whose device forgot them, and gated that on "no stored player" — which is also
 * true of every first-time joiner, so the ordinary two-people-picked-Anna case was told
 * its points could not be recovered. "Can this device persist anything?" is the question
 * that actually separates the two.
 */
const persisted = new Map<string, boolean>();

/**
 * A v4 UUID, or a last-resort substitute.
 *
 * `crypto.randomUUID` is undefined rather than throwing outside a secure context, and
 * this project is served over HTTPS, so the fallback should never run. It exists because
 * this module's whole contract is that it always returns something: an exception on this
 * line would propagate into the join path and take a device out of the session over an
 * anti-farming counter. The substitute is not cryptographically random, which costs
 * nothing here — a collision means two devices share a cap counter, not that anyone can
 * read anything.
 */
function mint(): string {
  try {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through to the substitute below.
  }

  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * This device's id: the stored one, or a newly minted one that is stored if it can be.
 *
 * Never returns an empty string — see the module docstring for why that is the load
 * bearing part of the contract.
 */
export function deviceId(storageKey: string): string {
  const memo = minted.get(storageKey);
  if (memo !== undefined) return memo;

  try {
    const raw = window.localStorage.getItem(storageKey);
    // A stored empty string is not an id. It would be sent as one and refused by the
    // route, which is the one outcome this module exists to make impossible.
    if (typeof raw === "string" && raw.length > 0) {
      minted.set(storageKey, raw);
      // It read back what a previous load wrote, so persistence demonstrably works.
      persisted.set(storageKey, true);
      return raw;
    }
  } catch {
    // Storage unavailable. Mint below rather than give up — the join must go through.
  }

  const id = mint();
  minted.set(storageKey, id);

  try {
    window.localStorage.setItem(storageKey, id);
    persisted.set(storageKey, true);
  } catch {
    // Private mode, quota, disabled storage. The id still works for this page load;
    // the next one gets a different one and a fresh cap allowance. `player.ts`'s
    // reasoning, and the accepted cost named in the module docstring.
    persisted.set(storageKey, false);
  }

  return id;
}

/**
 * Whether anything this device stores will survive a reload.
 *
 * `false` means storage is genuinely unavailable — a private tab, disabled storage, a
 * full quota — so this device cannot hold a player either, and a `taken` refusal may
 * honestly be the attendee's own name coming back at them.
 *
 * **`true` is not a promise that nothing was lost.** Site data cleared mid-session
 * leaves working storage and no player, and this cannot see the difference. That is the
 * accepted narrowness of the fix: it never misfires on a first-time joiner, which the
 * previous test — "no stored player" — did on the most common refusal in the room.
 *
 * Defaults to `true` when `deviceId` has not run: absent evidence of a storage problem
 * is not evidence of one, and the fallback is the plain, always-correct message.
 */
export function deviceStoragePersists(storageKey: string): boolean {
  return persisted.get(storageKey) !== false;
}
