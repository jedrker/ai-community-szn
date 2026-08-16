import { resend } from "./resend";

/**
 * Resend Audiences is the subscriber store. There is no local persistence —
 * the serverless filesystem is not writable, so anything written there is lost.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubscribeResult = "subscribed" | "already-subscribed";

/** Thrown when the newsletter cannot work at all because config is missing. */
export class NewsletterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterUnavailableError";
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * Adds the email to the Resend Audience. Duplicate detection comes from Resend,
 * not from a local file. Throws when the signup could not be recorded — callers
 * must not report success in that case.
 */
export async function addSubscriber(email: string): Promise<SubscribeResult> {
  const audienceId = import.meta.env.RESEND_AUDIENCE_ID;

  if (!import.meta.env.RESEND_API_KEY || !audienceId) {
    throw new NewsletterUnavailableError(
      "RESEND_API_KEY and RESEND_AUDIENCE_ID must both be set to accept signups",
    );
  }

  // Resend resolves with `{ error }` instead of throwing, so an unchecked read
  // degrades a 500/429/auth failure into "not a duplicate" — the answer that
  // happens to look like success. A lookup that could not run is a failure.
  const existing = await resend.contacts.get({ email, audienceId });
  if (existing.error && existing.error.name !== "not_found") {
    throw new Error(`Resend contacts.get failed: ${existing.error.message}`);
  }
  if (existing.data) {
    return "already-subscribed";
  }

  const created = await resend.contacts.create({ email, audienceId });
  if (created.error) {
    throw new Error(`Resend contacts.create failed: ${created.error.message}`);
  }

  return "subscribed";
}
