import type { APIRoute } from "astro";
import { resend } from "../../lib/resend";
import { sendSlackNotification } from "../../lib/slack";

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
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const adminEmail = import.meta.env.ADMIN_EMAIL;

  if (import.meta.env.RESEND_API_KEY) {
    try {
      // Notification to admin
      if (adminEmail) {
        await resend.emails.send({
          from: "Brave AI Community <noreply@ai-community.szczecin.pl>",
          to: adminEmail,
          subject: `Nowe zgłoszenie prelegenta: ${name}`,
          html: `
            <h2>Nowe zgłoszenie prelegenta</h2>
            <p><strong>Imię i nazwisko:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temat prezentacji:</strong> ${topic}</p>
            <p><strong>Bio:</strong> ${bio}</p>
            ${linkedin ? `<p><strong>LinkedIn:</strong> ${linkedin}</p>` : ""}
            ${github ? `<p><strong>GitHub:</strong> ${github}</p>` : ""}
            ${website ? `<p><strong>Strona www:</strong> ${website}</p>` : ""}
          `,
        });
      }

      // Confirmation email to speaker
      await resend.emails.send({
        from: "Brave AI Community <noreply@ai-community.szczecin.pl>",
        to: email,
        subject: "Dziękujemy za zgłoszenie — Brave AI Community Szczecin",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #e0e0e0; background-color: #1a1a2e; padding: 32px; border-radius: 12px;">
            <h1 style="color: #7c3aed; font-size: 24px;">Cześć, ${name}! 👋</h1>
            <p style="font-size: 16px; line-height: 1.6;">
              Dziękujemy za zgłoszenie się jako prelegent/ka na meetup <strong>Brave AI Community Szczecin</strong>.
            </p>
            <p style="font-size: 15px; line-height: 1.6;">
              Otrzymaliśmy Twoje zgłoszenie z tematem: <strong>${topic}</strong>
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
    } catch (err) {
      console.error("Failed to send speaker emails:", err);
    }
  }

  // Slack notification
  try {
    await sendSlackNotification(
      `🎤 Nowe zgłoszenie prelegenta!\n*${name}* (${email})\nTemat: ${topic}`
    );
  } catch (err) {
    console.error("Failed to send Slack notification:", err);
  }

  return new Response(
    JSON.stringify({
      message: "Dziękujemy za zgłoszenie! Odezwiemy się wkrótce.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
