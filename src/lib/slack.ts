/**
 * Posts to the Slack webhook. Never throws into a request path — a caller that
 * needs to know whether the message landed reads the returned boolean instead.
 * `false` covers all three failures: missing config, a non-OK response, and a
 * transport error. Returning the outcome is what lets a route distinguish
 * "notified somebody" from "told the user it worked and notified nobody".
 */
export async function sendSlackNotification(text: string): Promise<boolean> {
  const webhookUrl = import.meta.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL is not set — Slack notifications disabled");
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      console.error("Slack webhook failed:", response.status);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Failed to send Slack notification:", err);
    return false;
  }
}
