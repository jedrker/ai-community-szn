/**
 * The device's own player record, in `localStorage` (roadmap S-02).
 *
 * ## The retention position, stated rather than left to be found
 *
 * This is attendee data written to a browser, and **no `purge` will ever reach it**.
 * That is compliant rather than a gap: the PRD's retention guardrail is about
 * *operator-accessible* storage, and a phone in someone's pocket is not that. The
 * storage key itself is declared in `src/lib/session/keys.ts` alongside
 * `SESSION_CHANNEL`, for the same reason that one is — the invariant is "one module
 * owns every namespaced name", and an invariant with an exemption list is one that
 * rots. It arrives here through `define:vars` as an argument, because a client module
 * may not value-import from `src/lib/session/` (`boundary.test.ts`).
 *
 * ## Why the read matters as much as the write
 *
 * The stored record is read on **every page load**, not only written on join. That read
 * is the whole reload path: an attendee who reloads mid-question holds their own name,
 * so sending them back to the form would have them refused by their own claim and
 * locked out for the rest of the segment. `clearPlayer` is the other half — a device
 * whose id no longer resolves must drop it rather than carry a ghost player into the
 * next session.
 *
 * S-09 extends this to a score-intact resume across the spine's own reconnects. This
 * slice establishes the handshake and nothing more.
 *
 * ## Nothing here throws
 *
 * Safari in private mode throws on write, storage can be disabled outright, and the
 * stored value can be malformed by a previous version of this code. Every one of those
 * is reported as "no stored player" and the attendee simply types their name again.
 * A join must never fail because of a storage quirk — the `src/lib/slack.ts` posture,
 * applied on the client.
 */

export type StoredPlayer = {
  readonly id: string;
  readonly displayName: string;
};

function isStoredPlayer(value: unknown): value is StoredPlayer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.displayName === "string" &&
    candidate.displayName.length > 0
  );
}

/** The stored record, or `null` for absent, malformed, or unavailable storage. */
export function readPlayer(storageKey: string): StoredPlayer | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isStoredPlayer(parsed)) {
      // Written by an older shape of this code, or hand-edited. Drop it rather than
      // keep handing back something the caller cannot use.
      clearPlayer(storageKey);
      return null;
    }

    return { id: parsed.id, displayName: parsed.displayName };
  } catch {
    return null;
  }
}

/**
 * Stores the record. Silent on failure by design: the join already succeeded server-side
 * and the attendee is in — losing the ability to survive a reload is worse than an
 * error message, but it is not worth failing the join over.
 */
export function writePlayer(storageKey: string, player: StoredPlayer): void {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ id: player.id, displayName: player.displayName }),
    );
  } catch {
    // Private mode, quota, disabled storage. Nothing to do and nothing to report.
  }
}

export function clearPlayer(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Same reasoning as `writePlayer`.
  }
}
