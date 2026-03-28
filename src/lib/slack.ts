export async function sendSlackNotification(text: string): Promise<void> {
  const webhookUrl = import.meta.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL is not set — Slack notifications disabled");
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      console.error("Slack webhook failed:", response.status);
    }
  } catch (err) {
    console.error("Failed to send Slack notification:", err);
  }
}
