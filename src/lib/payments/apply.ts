import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { activities, auditLogs, invoices, payments } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { cashDueCents } from "@/lib/credits/client-memo";
import { achFeeCents, cardFeeCents } from "@/lib/money";
import { emitAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";
import { dismissCollections } from "@/lib/services/collections";
import { bindReviewEmit, considerReview } from "@/lib/services/reviews";
import { syncJobCommissions } from "@/lib/services/commissions";

export type StripePaymentEvent = {
  eventId: string;
  type: string;
  paymentIntentId: string;
  amountCents: number;
  invoiceId?: string | null;
  orgId?: string | null;
  method: "ach" | "card";
  failureReason?: string | null;
};

export type ApplyResult = {
  applied: boolean;
  duplicate: boolean;
  status: string;
};

export function stripeIdempotencyKey(invoiceId: string, amountCents: number): string {
  return `stripe:${invoiceId}:${amountCents}`;
}

function ledgerStatus(type: string): "succeeded" | "processing" | "failed" | null {
  if (type === "payment_intent.succeeded") return "succeeded";
  if (type === "payment_intent.processing") return "processing";
  if (type === "payment_intent.payment_failed") return "failed";
  return null;
}

function remember(tx: ReturnType<typeof getDb>, orgId: string, event: StripePaymentEvent, status: string) {
  tx.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId: null,
      action: "stripe.webhook",
      entityType: "stripe_event",
      entityId: event.eventId,
      payloadJson: JSON.stringify({ status, paymentIntentId: event.paymentIntentId, type: event.type }),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

/**
 * Apply a verified Stripe PaymentIntent event once.
 * The invoice is marked paid only on succeeded. amountPaid grows by the cash still due, never twice for the same PaymentIntent.
 */
export function applyStripePaymentEvent(event: StripePaymentEvent): ApplyResult {
  if (!event.eventId || !event.paymentIntentId) throw new ServiceError("Stripe event is missing an id.");
  const db = getDb();
  const result = db.transaction((tx) => {
    const seen = tx
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "stripe.webhook"), eq(auditLogs.entityId, event.eventId)))
      .get();
    if (seen) return { applied: false, duplicate: true, status: "duplicate" };

    const next = ledgerStatus(event.type);
    const byIntent = tx.select().from(payments).where(eq(payments.stripePaymentIntent, event.paymentIntentId)).get();
    const invoiceId = byIntent?.invoiceId ?? event.invoiceId;
    if (!invoiceId) throw new ServiceError("This PaymentIntent is not tied to an invoice.");
    const invoice = tx
      .select()
      .from(invoices)
      .where(
        event.orgId
          ? and(eq(invoices.id, invoiceId), eq(invoices.orgId, event.orgId))
          : eq(invoices.id, invoiceId),
      )
      .get();
    if (!invoice) throw new ServiceError("Invoice not found for this PaymentIntent.");
    if (byIntent && byIntent.orgId !== invoice.orgId) throw new ServiceError("Payment org does not match the invoice.");

    if (!next) {
      remember(tx, invoice.orgId, event, "ignored");
      return { applied: false, duplicate: false, status: "ignored" };
    }
    const due = cashDueCents(invoice.totalCents, invoice.amountPaidCents);
    if (due < 1) {
      if (byIntent?.status === "succeeded") {
        remember(tx, invoice.orgId, event, "succeeded");
        return { applied: false, duplicate: true, status: "succeeded" };
      }
      remember(tx, invoice.orgId, event, "paid");
      return { applied: false, duplicate: false, status: "paid" };
    }
    if (event.amountCents !== due) {
      remember(tx, invoice.orgId, event, "amount_mismatch");
      return { applied: false, duplicate: false, status: "amount_mismatch" };
    }

    const key = stripeIdempotencyKey(invoice.id, due);
    const byKey = tx
      .select()
      .from(payments)
      .where(and(eq(payments.idempotencyKey, key), eq(payments.orgId, invoice.orgId)))
      .get();
    if (byKey?.stripePaymentIntent && byKey.stripePaymentIntent !== event.paymentIntentId) {
      remember(tx, invoice.orgId, event, "intent_mismatch");
      return { applied: false, duplicate: false, status: "intent_mismatch" };
    }
    const payment = byIntent ?? byKey;
    if (payment?.status === "succeeded") {
      remember(tx, invoice.orgId, event, "succeeded");
      return { applied: false, duplicate: true, status: "succeeded" };
    }
    if (invoice.status === "void") {
      remember(tx, invoice.orgId, event, "void");
      return { applied: false, duplicate: false, status: "void" };
    }

    const now = nowIso();
    const fee = next === "succeeded" ? (event.method === "ach" ? achFeeCents(due) : cardFeeCents(due)) : 0;
    const patch = {
      method: event.method,
      amountCents: due,
      feeCents: fee,
      netCents: next === "succeeded" ? due - fee : 0,
      status: next,
      stripePaymentIntent: event.paymentIntentId,
      failureReason: next === "failed" ? event.failureReason || "The payment failed." : null,
      stub: 0,
      updatedAt: now,
    };
    if (payment) {
      tx.update(payments)
        .set(patch)
        .where(and(eq(payments.id, payment.id), eq(payments.orgId, invoice.orgId)))
        .run();
    } else {
      tx.insert(payments)
        .values({
          id: id("pay"),
          orgId: invoice.orgId,
          invoiceId: invoice.id,
          idempotencyKey: key,
          createdAt: now,
          ...patch,
        })
        .run();
    }

    if (next === "succeeded" && invoice.status !== "paid") {
      tx.update(invoices)
        .set({ status: "paid", amountPaidCents: invoice.amountPaidCents + due, updatedAt: now })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, invoice.orgId)))
        .run();
      tx.insert(activities)
        .values({
          id: id("act"),
          orgId: invoice.orgId,
          entityType: "project",
          entityId: invoice.projectId,
          type: "payment",
          actorType: "system",
          actorId: null,
          summary: `Stripe confirmed payment for ${invoice.number}.`,
          payloadJson: JSON.stringify({ paymentIntentId: event.paymentIntentId }),
          createdAt: now,
        })
        .run();
    } else if (next === "failed") {
      tx.insert(activities)
        .values({
          id: id("act"),
          orgId: invoice.orgId,
          entityType: "project",
          entityId: invoice.projectId,
          type: "payment",
          actorType: "system",
          actorId: null,
          summary: `Stripe payment failed for ${invoice.number}.`,
          payloadJson: null,
          createdAt: now,
        })
        .run();
    }

    remember(tx, invoice.orgId, event, next);
    return { applied: next === "succeeded", duplicate: false, status: next };
  });
  if (result.applied && result.status === "succeeded") {
    try {
      bindReviewEmit(emitAutomation);
      const payment = db.select().from(payments).where(eq(payments.stripePaymentIntent, event.paymentIntentId)).get();
      if (payment) {
        const paid = db.select().from(invoices).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.orgId, payment.orgId))).get();
        if (paid) {
          try {
            considerReview(paid.orgId, paid.projectId, "paid");
          } catch {
            // A review miss does not undo the payment.
          }
          dismissCollections(paid.orgId, paid.id);
          try {
            syncJobCommissions(paid.orgId, paid.projectId);
          } catch {
            // A commission miss does not undo the payment.
          }
        }
      }
    } catch {
      // A follow-up miss does not undo the payment.
    }
  }
  return result;
}
