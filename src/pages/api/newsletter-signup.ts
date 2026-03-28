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
    await resend.emails.send({
      from: "Brave AI Community <noreply@braveai.community>",
      to: email,
      subject: "Witamy w Brave AI Community Szczecin!",
      html: `<p>Cześć!</p><p>Dziękujemy za zapisanie się do newslettera Brave AI Community Szczecin. Powiadomimy Cię o nadchodzących meetupach.</p><p>Do zobaczenia!</p>`,
    });
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
