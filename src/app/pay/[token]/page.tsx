import Link from "next/link";
import { notFound } from "next/navigation";
import { PayForm } from "@/components/pay-form";
import { StripePayForm } from "@/components/stripe-pay-form";
import { formatMoney } from "@/lib/money";
import { ensureStripePaymentIntent } from "@/lib/payments/intent";
import { ServiceError } from "@/lib/services/errors";
import { invoiceByPayToken } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ redirect_status?: string }>;
}) {
  const { token } = await params;
  const { redirect_status: redirectStatus } = await searchParams;
  const data = invoiceByPayToken(token);
  if (!data?.invoice || !data.org || !data.project) notFound();
  const paid = data.invoice.status === "paid";
  const stripeOn = Boolean(process.env.STRIPE_SECRET_KEY);
  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-8">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{data.org.name}</p>
      <h1 className="font-heading text-4xl">{formatMoney(data.invoice.totalCents)}</h1>
      <p className="text-sm">
        {data.invoice.number} · {data.invoice.type} · {data.project.name}
      </p>
      <p className="text-sm text-muted-foreground">Due {data.invoice.dueDate}</p>
      <ul className="mt-4 text-sm">
        {data.lines.map((line) => (
          <li key={line.id} className="flex justify-between py-1">
            <span>{line.description}</span>
            <span>{formatMoney(line.amountCents)}</span>
          </li>
        ))}
      </ul>
      {data.project.portalToken ? (
        <p className="mt-3 text-sm">
          <Link className="underline" href={`/portal/${data.project.portalToken}`}>
            Back to the project
          </Link>
        </p>
      ) : null}
      {paid ? (
        <PaidNote payments={data.payments} />
      ) : stripeOn ? (
        <StripeCheckout token={token} redirectStatus={redirectStatus} />
      ) : (
        <section className="mt-6">
          <PayForm token={token} cardEnabled={data.org.cardEnabled === 1} />
        </section>
      )}
      {data.payments.some((payment) => payment.status === "failed") ? (
        <p className="mt-4 text-sm text-destructive">
          Last attempt failed: {data.payments.find((payment) => payment.status === "failed")?.failureReason} The invoice is still open.
        </p>
      ) : null}
    </main>
  );
}

function PaidNote({
  payments,
}: {
  payments: Array<{ method: string; amountCents: number; feeCents: number }>;
}) {
  return (
    <section className="mt-6 rounded-xl bg-primary p-4 text-primary-foreground">
      <h2 className="font-heading text-2xl">Paid</h2>
      <p className="text-sm">Thank you. The contractor has the receipt in Fieldline.</p>
      {payments[0] ? (
        <p className="mt-2 text-xs opacity-80">
          {payments[0].method.toUpperCase()} · {formatMoney(payments[0].amountCents)} · fee {formatMoney(payments[0].feeCents)} kept by the processor, not added to your total.
        </p>
      ) : null}
    </section>
  );
}

async function StripeCheckout({ token, redirectStatus }: { token: string; redirectStatus?: string }) {
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  let error: string | null = null;
  let intent: { clientSecret: string | null; status: string } | null = null;
  if (!publishable) {
    error = "Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to a pk_test_ key. The local test-number form stays off while STRIPE_SECRET_KEY is set.";
  } else {
    try {
      intent = await ensureStripePaymentIntent(token);
    } catch (caught) {
      error = caught instanceof ServiceError ? caught.message : "Stripe could not open this payment.";
    }
  }
  const fresh = invoiceByPayToken(token);
  if (fresh?.invoice.status === "paid" && fresh.payments) {
    return <PaidNote payments={fresh.payments} />;
  }
  const waiting = intent?.status === "processing" || intent?.status === "succeeded";
  return (
    <section className="mt-6">
      {redirectStatus === "failed" ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          The bank or card was not accepted. The invoice is still open.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : waiting ? (
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl">{intent?.status === "processing" ? "Processing" : "Waiting on Stripe"}</h2>
          <p className="text-sm text-muted-foreground">
            {intent?.status === "processing"
              ? "The bank payment is processing. This invoice stays open until Stripe reports success."
              : "Stripe accepted the payment. This invoice is marked paid when the webhook arrives."}
          </p>
        </div>
      ) : intent?.clientSecret && publishable ? (
        <StripePayForm publishableKey={publishable} clientSecret={intent.clientSecret} />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Stripe did not return a client secret for this invoice.
        </p>
      )}
    </section>
  );
}
