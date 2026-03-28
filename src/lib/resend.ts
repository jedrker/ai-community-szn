import { Resend } from "resend";

const apiKey = import.meta.env.RESEND_API_KEY;

if (!apiKey) {
  console.warn("RESEND_API_KEY is not set — email features will not work");
}

export const resend = new Resend(apiKey || "");
