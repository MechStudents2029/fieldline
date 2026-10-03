import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import { achFeeCents } from "@/lib/money";
import { applyStripePaymentEvent } from "@/lib/payments/apply";
import { ensureStripePaymentIntent, paymentMode } from "@/lib/payments/intent";
import { handleStripeWebhook } from "@/app/api/stripe/webhook/route";

beforeAll(() => {
  useDatabaseFile(":memory:");
});

afterAll(() => {
  useDatabaseFile(":memory:");
});

function invoice(id: string) {
  return getDb().select().from(invoices).where(eq(invoices.id, id)).get();
}

describe("stripe test-mode payments", () => {
  it("reports stripe only when a secret key is present", () => {
    expect(paymentMode({})).toBe("demo");
    expect(paymentMode({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe("stripe");
    expect(paymentMode({ STRIPE_SECRET_KEY: "sk_live_x" })).toBe("stripe");
  });

  it("opens one PaymentIntent and leaves the invoice open", async () => {
    const previousSecret = process.env.STRIPE_SECRET_KEY;
    const previousPublishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fieldline";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fieldline";
    const created: string[] = [];
    const client = {
      async createPaymentIntent(input: {
        amount: number;
        paymentMethodTypes: string[];
        idempotencyKey: string;
      }) {
        created.push(input.idempotencyKey);
        expect(input.amount).toBe(736000);
        expect(input.paymentMethodTypes[0]).toBe("us_bank_account");
        expect(input.paymentMethodTypes).toContain("card");
        return { id: "pi_test_chen", clientSecret: "pi_test_chen_secret", status: "requires_payment_method" };
      },
      async retrievePaymentIntent(id: string) {
        return { id, clientSecret: "pi_test_chen_secret", status: "requires_payment_method" };
      },
    };
    try {
      const first = await ensureStripePaymentIntent("demo_pay_chen_deposit", client);
      const second = await ensureStripePaymentIntent("demo_pay_chen_deposit", client);
      expect(created).toEqual(["stripe:inv_chen_dep:736000"]);
      expect(first.paymentIntentId).toBe("pi_test_chen");
      expect(second.paymentIntentId).toBe("pi_test_chen");
      expect(invoice("inv_chen_dep")?.status).toBe("open");
      expect(invoice("inv_chen_dep")?.amountPaidCents).toBe(0);
      const rows = getDb().select().from(payments).where(eq(payments.invoiceId, "inv_chen_dep")).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.stripePaymentIntent).toBe("pi_test_chen");
      expect(rows[0]?.stub).toBe(0);
    } finally {
      if (previousSecret == null) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousSecret;
      if (previousPublishable == null) delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = previousPublishable;
    }
  });

  it("refuses a live secret before creating a PaymentIntent", async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_nope";
    const client = {
      async createPaymentIntent() {
        throw new Error("should not create");
      },
      async retrievePaymentIntent() {
        throw new Error("should not retrieve");
      },
    };
    try {
      await expect(ensureStripePaymentIntent("demo_pay_chen_deposit", client)).rejects.toThrow(/sk_test_/);
    } finally {
      if (previous == null) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previous;
    }
  });

  it("applies a succeeded PaymentIntent once", () => {
    const first = applyStripePaymentEvent({
      eventId: "evt_chen_1",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_test_chen",
      amountCents: 736000,
      invoiceId: "inv_chen_dep",
      orgId: "org_rivera",
      method: "ach",
    });
    const second = applyStripePaymentEvent({
      eventId: "evt_chen_2",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_test_chen",
      amountCents: 736000,
      invoiceId: "inv_chen_dep",
      orgId: "org_rivera",
      method: "ach",
    });
    const replay = applyStripePaymentEvent({
      eventId: "evt_chen_1",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_test_chen",
      amountCents: 736000,
      invoiceId: "inv_chen_dep",
      orgId: "org_rivera",
      method: "ach",
    });
    expect(first).toMatchObject({ applied: true, duplicate: false, status: "succeeded" });
    expect(second.duplicate).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(invoice("inv_chen_dep")).toMatchObject({ status: "paid", amountPaidCents: 736000 });
    const rows = getDb().select().from(payments).where(eq(payments.invoiceId, "inv_chen_dep")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.feeCents).toBe(achFeeCents(736000));
  });

  it("keeps ACH processing open and marks paid only on success", () => {
    const processing = applyStripePaymentEvent({
      eventId: "evt_ok_proc",
      type: "payment_intent.processing",
      paymentIntentId: "pi_ok",
      amountCents: 1680000,
      invoiceId: "inv_ok_prog",
      orgId: "org_rivera",
      method: "ach",
    });
    expect(processing.status).toBe("processing");
    expect(invoice("inv_ok_prog")?.status).toBe("open");
    const paid = applyStripePaymentEvent({
      eventId: "evt_ok_paid",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_ok",
      amountCents: 1680000,
      invoiceId: "inv_ok_prog",
      orgId: "org_rivera",
      method: "ach",
    });
    expect(paid.applied).toBe(true);
    expect(invoice("inv_ok_prog")).toMatchObject({ status: "paid", amountPaidCents: 1680000 });
    const again = applyStripePaymentEvent({
      eventId: "evt_ok_paid_again",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_ok",
      amountCents: 1680000,
      invoiceId: "inv_ok_prog",
      orgId: "org_rivera",
      method: "ach",
    });
    expect(again.duplicate).toBe(true);
    expect(invoice("inv_ok_prog")?.amountPaidCents).toBe(1680000);
  });

  it("does not pay a failed or mismatched event", () => {
    const mismatch = applyStripePaymentEvent({
      eventId: "evt_br_mismatch",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_br",
      amountCents: 100,
      invoiceId: "inv_br_prog",
      orgId: "org_rivera",
      method: "ach",
    });
    expect(mismatch.status).toBe("amount_mismatch");
    const failed = applyStripePaymentEvent({
      eventId: "evt_br_fail",
      type: "payment_intent.payment_failed",
      paymentIntentId: "pi_br_fail",
      amountCents: 3440000,
      invoiceId: "inv_br_prog",
      orgId: "org_rivera",
      method: "ach",
      failureReason: "Insufficient funds.",
    });
    expect(failed.status).toBe("failed");
    expect(invoice("inv_br_prog")).toMatchObject({ status: "open", amountPaidCents: 0 });
  });

  it("rejects an unsigned webhook on a public deploy and does not apply the demo stub", async () => {
    const before = invoice("inv_dz_final");
    const unsigned = await handleStripeWebhook(
      new Request("http://127.0.0.1/api/stripe/webhook", {
        method: "POST",
        body: JSON.stringify({ type: "payment_intent.succeeded" }),
      }),
      { VERCEL: "1" },
    );
    expect(unsigned.status).toBe(401);
    const demo = await handleStripeWebhook(
      new Request("http://127.0.0.1/api/stripe/webhook", {
        method: "POST",
        headers: { "x-fieldline-demo": "1", "content-type": "application/json" },
        body: JSON.stringify({
          id: "evt_demo",
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_demo", amount: 480000, metadata: { invoiceId: "inv_dz_final", orgId: "org_rivera" } } },
        }),
      }),
      {},
    );
    expect(demo.status).toBe(200);
    expect(await demo.json()).toMatchObject({ ok: true, stub: true });
    expect(invoice("inv_dz_final")).toMatchObject({ status: before?.status, amountPaidCents: before?.amountPaidCents });
  });

  it("applies a signed webhook once", async () => {
    const secret = "whsec_test_fieldline";
    const payload = JSON.stringify({
      id: "evt_dz_signed",
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_dz_signed",
          object: "payment_intent",
          amount: 480000,
          currency: "usd",
          status: "succeeded",
          metadata: { invoiceId: "inv_dz_final", orgId: "org_rivera" },
          payment_method_types: ["us_bank_account", "card"],
          latest_charge: null,
          payment_method: null,
        },
      },
    });
    const stripe = new Stripe("sk_test_fieldline");
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const post = () =>
      handleStripeWebhook(
        new Request("http://127.0.0.1/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: payload,
        }),
        { STRIPE_WEBHOOK_SECRET: secret, STRIPE_SECRET_KEY: "sk_test_fieldline" },
      );
    const first = await post();
    const second = await post();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, applied: true, status: "succeeded" });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(invoice("inv_dz_final")).toMatchObject({ status: "paid", amountPaidCents: 480000 });
  });
});
