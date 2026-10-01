import fs from "node:fs";
import path from "node:path";

export type OutboundMessage = {
  channel: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  stub: boolean;
  providerId?: string;
};

export async function deliverMessage(message: OutboundMessage): Promise<OutboundMessage> {
  if (message.channel === "email" && process.env.RESEND_API_KEY) {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || "Fieldline <proposals@example.com>";
    const sent = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject || "Message from your contractor",
      text: message.body,
    });
    return { ...message, stub: false, providerId: sent.data?.id };
  }

  if (message.channel === "sms" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const body = new URLSearchParams({
      To: message.to,
      From: process.env.TWILIO_FROM_NUMBER,
      Body: message.body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Twilio rejected the message: ${detail.slice(0, 180)}`);
    }
    const json = (await response.json()) as { sid?: string };
    return { ...message, stub: false, providerId: json.sid };
  }

  const dir = path.join(process.cwd(), "data", "outbox");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${message.channel}.jsonl`), `${JSON.stringify({ ...message, at: new Date().toISOString(), stub: true })}\n`);
  return { ...message, stub: true, providerId: `stub_${message.channel}` };
}
