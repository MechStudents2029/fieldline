import Link from "next/link";
import { notFound } from "next/navigation";
import { PayForm } from "@/components/pay-form";
import { formatMoney } from "@/lib/money";
import { invoiceByPayToken } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = invoiceByPayToken(token);
  if (!data?.invoice || !data.org || !data.project) notFound();
  const paid = data.invoice.status === "paid";
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
        <section className="mt-6 rounded-xl bg-primary p-4 text-primary-foreground">
          <h2 className="font-heading text-2xl">Paid</h2>
          <p className="text-sm">Thank you. The contractor has the receipt in Fieldline.</p>
          {data.payments[0] ? (
            <p className="mt-2 text-xs opacity-80">
              {data.payments[0].method.toUpperCase()} · {formatMoney(data.payments[0].amountCents)} · fee {formatMoney(data.payments[0].feeCents)} kept by the processor, not added to your total.
            </p>
          ) : null}
        </section>
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
