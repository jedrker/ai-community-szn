/**
 * The message bubble's dismissal clock — a toast's "and then it goes away", as a state
 * machine that can be tested.
 *
 * **It lives here rather than inline in `host.astro` for the reason `countdown.ts` records,
 * and for a second one that is specific to that page.** An Astro page's inline `<script>`
 * has no harness, so the only guard available there is a source-text scan, and a scan cannot
 * execute a timer. That is how a clock once outlived a purged session with a green suite over
 * it. The second reason is mechanical: `host/[slug].test.ts` pins that page to exactly one timer
 * handle and exactly one `clearTimeout`, both belonging to the poll — so a dismissal timer
 * written inline would either fail that guard or force it to be weakened into something that
 * protects nothing.
 *
 * The module knows nothing about registers, colours or copy. It owns one question only —
 * *when does the thing on screen stop being on screen* — and hands the answer back through
 * `onHide`.
 *
 * **The structural rule, inherited from `countdown.ts`: `show` never calls `onHide`.** Every
 * caller is inside a `say`, which is itself inside a render or a click handler; hiding
 * synchronously from there would blank a message in the same tick it was written. Only the
 * timer, firing with an empty stack beneath it, hides.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/` (`boundary.test.ts`), and does
 * not: it takes a number of milliseconds and calls back.
 */

export type AutoHideDeps = {
  /**
   * Take the message off screen. Called at most once per `show`, from the timer and never
   * from `show` itself.
   */
  readonly onHide: () => void;
  /** Used by a `show()` that names no duration of its own. */
  readonly defaultMs: number;
};

export type AutoHide = {
  /**
   * Something was just said. Arms the hide, dropping any hide already pending — so a burst
   * of messages leaves exactly one timer, keyed to the last thing said rather than to the
   * first. A host reading the third message is not interrupted by the first one's clock.
   *
   * A duration that is not a positive finite number means **never hide**: the message stays
   * until the next one replaces it. Failing that way round is deliberate — a bad number
   * leaves the host with a sentence they can still read, where the other direction blanks
   * the screen instantly and looks like nothing was ever said.
   */
  show(durationMs?: number): void;
  /** Drops the pending hide without hiding. Idempotent; safe when nothing is armed. */
  cancel(): void;
  /** Whether a hide is currently armed. For tests and for guards. */
  isRunning(): boolean;
};

export function createAutoHide(deps: AutoHideDeps): AutoHide {
  let timer: number | null = null;

  function clear(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  return {
    show(durationMs) {
      clear();

      const delay = durationMs ?? deps.defaultMs;
      if (!Number.isFinite(delay) || delay <= 0) return;

      timer = window.setTimeout(() => {
        timer = null;
        deps.onHide();
      }, delay);
    },

    cancel() {
      clear();
    },

    isRunning() {
      return timer !== null;
    },
  };
}
