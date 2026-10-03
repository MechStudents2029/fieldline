import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { applyStripePaymentEvent, type StripePaymentEvent } from "@/lib/payments/apply";
import { ServiceError } from "@/lib/services/errors";
import { demoWebhookAllowed } from "@/lib/security";

const APPLIED = new Set(["payment_intent.succeeded", "payment_intent.processing", "payment_intent.payment_failed"]);

type Env = Record<string, string | undefined>;

export async function POST(request: Request) {
  return handleStripeWebhook(request, process.env);
}

export async function handleStripeWebhook(request: Request, env: Env) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    if (!demoWebhookAllowed(env) || request.headers.get("x-fieldline-demo") !== "1") {
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
  const StripeSdk = (await import("stripe")).default;
  const client = new StripeSdk(env.STRIPE_SECRET_KEY || "sk_test_webhook");
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (!APPLIED.has(event.type)) {
    return NextResponse.json({ ok: true, type: event.type, status: "ignored" });
  }
  try {
    const result = applyStripePaymentEvent(paymentEventFromStripe(event));
    return NextResponse.json({ ok: true, type: event.type, ...result });
  } catch (error) {
    const message = error instanceof ServiceError ? error.message : "Could not apply the Stripe event.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function methodFromIntent(intent: Stripe.PaymentIntent): "ach" | "card" {
  const charge = intent.latest_charge;
  if (charge && typeof charge !== "string") {
    const type = charge.payment_method_details?.type;
    if (type === "card") return "card";
    if (type === "us_bank_account") return "ach";
  }
  if (intent.payment_method_types?.length === 1 && intent.payment_method_types[0] === "card") return "card";
  return "ach";
}

function paymentEventFromStripe(event: Stripe.Event): StripePaymentEvent {
  const intent = event.data.object as Stripe.PaymentIntent;
  return {
    eventId: event.id,
    type: event.type,
    paymentIntentId: intent.id,
    amountCents: intent.amount,
    invoiceId: intent.metadata?.invoiceId || null,
    orgId: intent.metadata?.orgId || null,
    method: methodFromIntent(intent),
    failureReason: intent.last_payment_error?.message ?? null,
  };
}
