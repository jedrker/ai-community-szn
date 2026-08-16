import type { APIRoute } from "astro";
import { resend } from "../../lib/resend";
import { sendSlackNotification } from "../../lib/slack";

/**
 * There is no database: the admin email and the Slack message are the only
 * records a speaker application ever leaves. So the route may only answer 200
 * once at least one of those two reached the organisers — a swallowed failure
 * here loses the application outright while telling the applicant "we'll be in
 * touch", and they have no way to know they should retry.
 *
 * The applicant's own confirmation mail is deliberately not part of that test:
 * the application is already recorded by then, so a failure is logged and the
 * applicant still gets their 200.
 */

/** Applicant-supplied text goes into an HTML email — escape it. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FROM = "Brave AI Community <noreply@ai-community.szczecin.pl>";

export const POST: APIRoute = async ({ request }) => {
  const formData = await request.formData();
  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const topic = formData.get("topic")?.toString().trim();
  const bio = formData.get("bio")?.toString().trim();
  const linkedin = formData.get("linkedin")?.toString().trim();
  const github = formData.get("github")?.toString().trim();
  const website = formData.get("website")?.toString().trim();

  if (!name || !email || !topic || !bio) {
    return new Response(
      JSON.stringify({ error: "Wypełnij wszystkie wymagane pola." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const apiKey = import.meta.env.RESEND_API_KEY;
  const adminEmail = import.meta.env.ADMIN_EMAIL;

  // Config gaps are logged rather than assumed: silently skipping the only
  // admin-facing record is exactly the failure this route must not hide.
  if (!apiKey) {
    console.error(
      "RESEND_API_KEY is not set — speaker application emails disabled",
    );
  }
  if (!adminEmail) {
    console.error(
      "ADMIN_EMAIL is not set — speaker applications reach no organiser by email",
    );
  }

  let recordedForOrganisers = false;

  if (apiKey && adminEmail) {
    try {
      // `resend.emails.send` resolves with `{ error }` on an API failure rather
      // than throwing, so the result has to be inspected — a bare await would
      // treat an invalid key or a 429 as a successful send.
      const { error } = await resend.emails.send({
        from: FROM,
        to: adminEmail,
        subject: `Nowe zgłoszenie prelegenta: ${name}`,
        html: `
            <h2>Nowe zgłoszenie prelegenta</h2>
            <p><strong>Imię i nazwisko:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Temat prezentacji:</strong> ${escapeHtml(topic)}</p>
            <p><strong>Bio:</strong> ${escapeHtml(bio)}</p>
            ${linkedin ? `<p><strong>LinkedIn:</strong> ${escapeHtml(linkedin)}</p>` : ""}
            ${github ? `<p><strong>GitHub:</strong> ${escapeHtml(github)}</p>` : ""}
            ${website ? `<p><strong>Strona www:</strong> ${escapeHtml(website)}</p>` : ""}
          `,
      });

      if (error) {
        console.error("Admin notification email failed:", error);
      } else {
        recordedForOrganisers = true;
      }
    } catch (err) {
      console.error("Admin notification email threw:", err);
    }
  }

  // Never throws; reports whether the message landed.
  const slackDelivered = await sendSlackNotification(
    `🎤 Nowe zgłoszenie prelegenta!\n*${name}* (${email})\nTemat: ${topic}`,
  );
  recordedForOrganisers = recordedForOrganisers || slackDelivered;

  if (!recordedForOrganisers) {
    console.error(
      "Speaker application reached nobody — both admin email and Slack failed",
    );
    return new Response(
      JSON.stringify({
        error:
          "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę — jeśli problem się powtórzy, napisz do nas na Facebooku lub LinkedIn.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Past this point the application is recorded, so a confirmation failure is
  // logged and nothing more: refusing here would ask the applicant to send a
  // second copy of something the organisers already have.
  if (apiKey) {
    try {
      const { error } = await resend.emails.send({
        from: FROM,
        to: email,
        subject: "Dziękujemy za zgłoszenie — Brave AI Community Szczecin",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #e0e0e0; background-color: #1a1a2e; padding: 32px; border-radius: 12px;">
            <h1 style="color: #7c3aed; font-size: 24px;">Cześć, ${escapeHtml(name)}! 👋</h1>
            <p style="font-size: 16px; line-height: 1.6;">
              Dziękujemy za zgłoszenie się jako prelegent/ka na meetup <strong>Brave AI Community Szczecin</strong>.
            </p>
            <p style="font-size: 15px; line-height: 1.6;">
              Otrzymaliśmy Twoje zgłoszenie z tematem: <strong>${escapeHtml(topic)}</strong>
            </p>
            <p style="font-size: 15px; line-height: 1.6;">
              Nasz zespół przejrzy zgłoszenie i odezwie się w ciągu kilku dni z informacjami o kolejnych krokach.
            </p>
            <p style="font-size: 15px; line-height: 1.6;">
              Tymczasem odwiedź naszą stronę: <a href="https://www.ai-community.szczecin.pl" style="color: #7c3aed;">ai-community.szczecin.pl</a>
            </p>
            <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;" />
            <p style="font-size: 12px; color: #888;">
              Brave AI Community Szczecin · Wspierane przez <a href="https://www.brave.courses/" style="color: #7c3aed;">Brave Courses</a>
            </p>
          </div>
        `,
      });

      if (error) {
        console.error("Speaker confirmation email failed:", error);
      }
    } catch (err) {
      console.error("Speaker confirmation email threw:", err);
    }
  }

  return new Response(
    JSON.stringify({
      message: "Dziękujemy za zgłoszenie! Odezwiemy się wkrótce.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
