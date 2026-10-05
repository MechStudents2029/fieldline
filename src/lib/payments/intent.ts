import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invoices, organizations, payments } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { stripeIdempotencyKey } from "@/lib/payments/apply";
import { ServiceError } from "@/lib/services/errors";

export type IntentSnapshot = {
  id: string;
  clientSecret: string | null;
  status: string;
};

export type StripeIntentClient = {
  createPaymentIntent(input: {
    amount: number;
    currency: "usd";
    paymentMethodTypes: Array<"us_bank_account" | "card">;
    metadata: Record<string, string>;
    description: string;
    idempotencyKey: string;
  }): Promise<IntentSnapshot>;
  retrievePaymentIntent(id: string): Promise<IntentSnapshot>;
};

export function paymentMode(env: Record<string, string | undefined>): "stripe" | "demo" {
  return env.STRIPE_SECRET_KEY ? "stripe" : "demo";
}

export function assertStripeTestKeys(secret: string | undefined, publishable?: string) {
  if (!secret) throw new ServiceError("STRIPE_SECRET_KEY is not set.");
  if (secret.startsWith("sk_live") || secret.startsWith("rk_live")) {
    throw new ServiceError("Use a Stripe test secret key (sk_test_…). Live keys are refused.");
  }
  if (publishable?.startsWith("pk_live")) {
    throw new ServiceError("Use a Stripe test publishable key (pk_test_…).");
  }
}

export function paymentMethodTypes(cardEnabled: boolean): Array<"us_bank_account" | "card"> {
  return cardEnabled ? ["us_bank_account", "card"] : ["us_bank_account"];
}

function localStatus(stripeStatus: string): string {
  if (stripeStatus === "processing") return "processing";
  if (stripeStatus === "succeeded") return "pending";
  if (stripeStatus === "canceled") return "canceled";
  return "pending";
}

export async function liveStripeClient(): Promise<StripeIntentClient> {
  const secret = process.env.STRIPE_SECRET_KEY;
  assertStripeTestKeys(secret, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secret || "");
  return {
    async createPaymentIntent(input) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency,
          allowed_payment_method_types: input.paymentMethodTypes,
          metadata: input.metadata,
          description: input.description,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
    },
    async retrievePaymentIntent(paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
    },
  };
}

/** Create or reuse the PaymentIntent for this open invoice. Does not mark the invoice paid. */
export async function ensureStripePaymentIntent(token: string, client?: StripeIntentClient) {
  assertStripeTestKeys(process.env.STRIPE_SECRET_KEY, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const stripe = client ?? (await liveStripeClient());
  const db = getDb();
  const invoice = db.select().from(invoices).where(eq(invoices.payToken, token)).get();
  if (!invoice) throw new ServiceError("Invoice not found.");
  if (invoice.status === "void") throw new ServiceError("This invoice was voided.");
  if (invoice.status === "paid") return { clientSecret: null as string | null, paymentIntentId: "", status: "succeeded" };

  const org = db.select().from(organizations).where(eq(organizations.id, invoice.orgId)).get();
  const key = stripeIdempotencyKey(invoice.id, invoice.totalCents);
  const existing = db
    .select()
    .from(payments)
    .where(and(eq(payments.orgId, invoice.orgId), eq(payments.idempotencyKey, key)))
    .get();

  let snapshot: IntentSnapshot;
  if (existing?.stripePaymentIntent) {
    snapshot = await stripe.retrievePaymentIntent(existing.stripePaymentIntent);
  } else {
    snapshot = await stripe.createPaymentIntent({
      amount: invoice.totalCents,
      currency: "usd",
      paymentMethodTypes: paymentMethodTypes(Boolean(org?.cardEnabled)),
      metadata: { invoiceId: invoice.id, orgId: invoice.orgId, payToken: invoice.payToken },
      description: `${org?.name ?? "Fieldline"} ${invoice.number}`,
      idempotencyKey: key,
    });
    const now = nowIso();
    const row = {
      method: "ach" as const,
      amountCents: invoice.totalCents,
      feeCents: 0,
      netCents: 0,
      status: localStatus(snapshot.status),
      stripePaymentIntent: snapshot.id,
      failureReason: null,
      stub: 0,
      updatedAt: now,
    };
    if (existing) {
      db.update(payments)
        .set(row)
        .where(and(eq(payments.id, existing.id), eq(payments.orgId, invoice.orgId)))
        .run();
    } else {
      try {
        db.insert(payments)
          .values({
            id: id("pay"),
            orgId: invoice.orgId,
            invoiceId: invoice.id,
            idempotencyKey: key,
            createdAt: now,
            ...row,
          })
          .run();
      } catch (error) {
        const raced = db
          .select()
          .from(payments)
          .where(and(eq(payments.orgId, invoice.orgId), eq(payments.idempotencyKey, key)))
          .get();
        if (!raced?.stripePaymentIntent) throw error;
        snapshot = await stripe.retrievePaymentIntent(raced.stripePaymentIntent);
      }
    }
  }

  if (existing?.stripePaymentIntent && existing.status !== "succeeded" && snapshot.status === "processing") {
    db.update(payments)
      .set({ status: "processing", updatedAt: nowIso() })
      .where(and(eq(payments.id, existing.id), eq(payments.orgId, invoice.orgId)))
      .run();
  }

  return { clientSecret: snapshot.clientSecret, paymentIntentId: snapshot.id, status: snapshot.status };
}
