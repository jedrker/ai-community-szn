import type { APIRoute } from "astro";
import { resend } from "../../lib/resend";

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

  if (import.meta.env.RESEND_API_KEY && adminEmail) {
    await resend.emails.send({
      from: "Brave AI Community <noreply@braveai.community>",
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

  return new Response(
    JSON.stringify({
      message: "Dziękujemy za zgłoszenie! Odezwiemy się wkrótce.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
