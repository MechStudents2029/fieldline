import { NextResponse } from "next/server";
import { demoWebhookAllowed } from "@/lib/security";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    if (!demoWebhookAllowed(process.env) || request.headers.get("x-fieldline-demo") !== "1") {
      return NextResponse.json(
        { ok: false, error: "Set STRIPE_WEBHOOK_SECRET before accepting webhooks." },
        { status: 401 },
      );
    }
    await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, stub: true });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false }, { status: 400 });
  const stripe = (await import("stripe")).default;
  const client = new stripe(process.env.STRIPE_SECRET_KEY || "");
  const payload = await request.text();
  try {
    const event = client.webhooks.constructEvent(payload, signature, secret);
    return NextResponse.json({ ok: true, type: event.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
