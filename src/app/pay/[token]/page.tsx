import Link from "next/link";
import { notFound } from "next/navigation";
import { PayForm } from "@/components/pay-form";
import { StripePayForm } from "@/components/stripe-pay-form";
import { formatDate } from "@/lib/format";
import { cashDueCents, paymentMethodLabel } from "@/lib/credits/client-memo";
import { formatMoney } from "@/lib/money";
import { ensureStripePaymentIntent } from "@/lib/payments/intent";
import { invoiceTypeLabel } from "@/lib/portal/summary";
import { ServiceError } from "@/lib/services/errors";
import { policyLineForOrg } from "@/lib/services/late-fees";
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
  const due = cashDueCents(data.invoice.totalCents, data.invoice.amountPaidCents);
  const stripeOn = Boolean(process.env.STRIPE_SECRET_KEY);
  const history = data.payments.filter((payment) => payment.status === "succeeded" || payment.method === "credit_memo");
  return (
    <main className="home home-proposal">
      <p className="home-company">{data.org.name}</p>
      <h1 className="home-price">{formatMoney(paid ? data.invoice.totalCents : due)}</h1>
      <p className="home-strong">{data.invoice.number}</p>
      <p className="home-sub">
        {invoiceTypeLabel(data.invoice.type)} · {data.project.name}
      </p>
      <p className="home-sub">Due {formatDate(data.invoice.dueDate)}</p>
      {policyLineForOrg(data.invoice.orgId) ? <p className="home-sub home-center" data-late-policy>{policyLineForOrg(data.invoice.orgId)}</p> : null}
      <ul className="home-scope">
        {data.lines.map((line) => (
          <li key={line.id}>
            <span>{line.description}</span>
            <span className="home-money">{formatMoney(line.amountCents)}</span>
          </li>
        ))}
      </ul>
      {data.project.portalToken ? (
        <p className="home-center">
          <Link className="home-link" href={`/portal/${data.project.portalToken}`}>
            Project
          </Link>
        </p>
      ) : null}
      {history.length ? (
        <section className="home-note" aria-label="Payments">
          <h2 className="home-title">Payments</h2>
          <ul className="home-scope">
            {history.map((payment) => (
              <li key={payment.id}>
                <span>
                  {paymentMethodLabel(payment.method)}
                  {payment.status === "void" ? " · Void" : ""}
                </span>
                <span className="home-money">{formatMoney(payment.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
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
    <section className="home-note">
      <h2 className="home-title">Paid</h2>
      {payments[0] ? <p className="home-money">{formatMoney(payments[0].amountCents)}</p> : null}
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
        <div className="home-note">
          <h2 className="home-title">{intent?.status === "processing" ? "Processing" : "Waiting on Stripe"}</h2>
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
