import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { declineAction, signAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { CONSENT_TEXT } from "@/lib/product";
import { formatMoney } from "@/lib/money";
import { proposalByToken } from "@/lib/services/read";
import { markProposalViewed } from "@/lib/services/write";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  markProposalViewed(token, headerList.get("x-forwarded-for") || "local");
  const data = proposalByToken(token);
  if (!data?.org) notFound();
  const snapshot = data.snapshot.public;
  const closed = ["signed", "declined", "superseded"].includes(data.proposal.status) || data.expired;
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{data.org.name}</p>
      <h1 className="font-heading text-4xl">{snapshot.title}</h1>
      <p className="mt-1 text-sm">
        Prepared for {snapshot.clientName}
        {snapshot.address ? ` · ${snapshot.address}` : ""}
      </p>
      {data.expired ? <p className="mt-4 rounded-lg bg-accent p-3 text-sm">This link has expired. Ask {data.org.name} for a new one.</p> : null}
      {data.proposal.status === "superseded" ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">A newer proposal replaced this one.</p> : null}
      {data.proposal.status === "signed" ? (
        <p className="mt-4 rounded-lg bg-primary p-3 text-sm text-primary-foreground">
          Signed by {data.signature?.typedName}.{" "}
          <Link href={`/p/${token}/certificate`} className="underline">
            Download the certificate
          </Link>
          {data.proposal.projectId ? "" : ""}
        </p>
      ) : null}
      <div className="mt-6 space-y-6">
        {snapshot.sections.map((section) => (
          <section key={section.name}>
            <h2 className="font-medium">{section.name}</h2>
            <ul className="mt-2 divide-y divide-border">
              {section.lines.map((line) => (
                <li key={`${section.name}-${line.name}`} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    {line.kind === "optional" ? "Optional · " : line.kind === "allowance" ? "Allowance · " : ""}
                    {line.name}
                    <span className="block text-xs text-muted-foreground">
                      {line.qty} {line.unit} × {formatMoney(line.unitPriceCents)}
                    </span>
                  </span>
                  <span>{formatMoney(line.priceCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>{formatMoney(snapshot.subtotalCents)}</span>
        </div>
        <div className="mt-2 flex justify-between font-heading text-2xl">
          <span>Total</span>
          <span>{formatMoney(snapshot.totalCents)}</span>
        </div>
        <ul className="mt-4 space-y-1 text-sm">
          {snapshot.schedule.map((part) => (
            <li key={part.type} className="flex justify-between">
              <span>{part.label}</span>
              <span>{formatMoney(part.amountCents)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{snapshot.disclaimer}</p>
      {!closed ? (
        <section className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl">Sign</h2>
          <ActionForm action={signAction.bind(null, token)} className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              Legal name
              <input name="signerName" required className="field mt-1" defaultValue={snapshot.clientName} />
            </label>
            <label className="text-sm">
              Type your name to sign
              <input name="typedName" required className="field mt-1 font-heading text-xl" placeholder={snapshot.clientName} />
            </label>
            <label className="text-sm">
              Email for a copy
              <input name="email" type="email" className="field mt-1" defaultValue={data.contact?.email ?? ""} />
            </label>
            <SignaturePad />
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" name="consent" className="mt-1" required />
              <span>{CONSENT_TEXT}</span>
            </label>
            <Button type="submit" className="h-11">
              Sign proposal
            </Button>
          </ActionForm>
          <ActionForm action={declineAction.bind(null, token)} className="mt-4 flex flex-col gap-2">
            <input name="reason" className="field" placeholder="Reason, if you want to leave one" />
            <button type="submit" className="text-left text-sm text-muted-foreground underline">
              Decline this proposal
            </button>
          </ActionForm>
        </section>
      ) : null}
      <p className="mt-8 text-center text-xs text-muted-foreground">Sent with Fieldline</p>
    </main>
  );
}
