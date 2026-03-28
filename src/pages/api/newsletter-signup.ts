import type { APIRoute } from "astro";
import { addSubscriber } from "../../lib/subscribers";
import { resend } from "../../lib/resend";

export const POST: APIRoute = async ({ request }) => {
  const formData = await request.formData();
  const email = formData.get("email")?.toString().trim();

  if (!email || !email.includes("@")) {
    return new Response(
      JSON.stringify({ error: "Podaj prawidłowy adres email" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const isNew = await addSubscriber(email);

  if (isNew && import.meta.env.RESEND_API_KEY) {
    const audienceId = import.meta.env.RESEND_AUDIENCE_ID;

    // Add contact to Resend Audience
    if (audienceId) {
      try {
        await resend.contacts.create({
          email,
          audienceId,
        });
      } catch (err) {
        console.error("Failed to add contact to Resend Audience:", err);
      }
    }

    // Send welcome email
    try {
      await resend.emails.send({
        from: "Brave AI Community <noreply@ai-community.szczecin.pl>",
        to: email,
        subject: "Witamy w Brave AI Community Szczecin!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #e0e0e0; background-color: #1a1a2e; padding: 32px; border-radius: 12px;">
            <h1 style="color: #7c3aed; font-size: 24px;">Cześć! 👋</h1>
            <p style="font-size: 16px; line-height: 1.6;">
              Dziękujemy za dołączenie do <strong>Brave AI Community Szczecin</strong> — społeczności AI w Szczecinie dla developerów, founderów i entuzjastów sztucznej inteligencji.
            </p>
            <h2 style="color: #7c3aed; font-size: 18px; margin-top: 24px;">Czym się zajmujemy?</h2>
            <p style="font-size: 15px; line-height: 1.6;">
              Organizujemy regularne meetupy skupione na <strong>praktycznych wdrożeniach AI</strong> — doświadczeniach produkcyjnych, sprawdzonych praktykach i wyzwaniach biznesowych. Prezentacje z Q&amp;A, open mic i networking.
            </p>
            <h2 style="color: #7c3aed; font-size: 18px; margin-top: 24px;">Bądź na bieżąco</h2>
            <p style="font-size: 15px; line-height: 1.6;">
              Będziemy informować Cię o nadchodzących meetupach i nowościach ze społeczności. Tymczasem dołącz do nas:
            </p>
            <div style="margin: 16px 0;">
              <a href="https://www.facebook.com/profile.php?id=61586808601675" style="color: #7c3aed; text-decoration: none; margin-right: 16px;">Facebook</a>
              <a href="https://www.linkedin.com/groups/16794026/" style="color: #7c3aed; text-decoration: none;">Grupa LinkedIn</a>
            </div>
            <p style="font-size: 15px; line-height: 1.6;">
              Odwiedź naszą stronę: <a href="https://www.ai-community.szczecin.pl" style="color: #7c3aed;">ai-community.szczecin.pl</a>
            </p>
            <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;" />
            <p style="font-size: 12px; color: #888;">
              Brave AI Community Szczecin · Wspierane przez <a href="https://www.brave.courses/" style="color: #7c3aed;">Brave Courses</a>
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error("Failed to send welcome email:", err);
    }
  }

  return new Response(
    JSON.stringify({
      message: isNew
        ? "Zapisano! Sprawdź swoją skrzynkę."
        : "Ten email jest już zapisany.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
