import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { declineAction, signAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { SignaturePad } from "@/components/signature-pad";
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
  const deposit = snapshot.schedule.find((part) => part.type === "deposit");
  return (
    <main className="home home-proposal">
      <p className="home-company">{data.org.name}</p>
      <p className="home-kicker">Proposal</p>
      <div className="home-hero" aria-hidden="true" />
      <h1 className="home-title">{snapshot.title}</h1>
      <p className="home-sub">
        Prepared for {snapshot.clientName}
        {snapshot.address ? ` · ${snapshot.address}` : ""}
      </p>
      {data.expired ? <p className="home-note">This link expired.</p> : null}
      {data.proposal.status === "superseded" ? <p className="home-note">Replaced by a newer proposal.</p> : null}
      {data.proposal.status === "signed" ? (
        <p className="home-note">
          Signed by {data.signature?.typedName}.{" "}
          <Link href={`/p/${token}/certificate`} className="home-link">
            Certificate
          </Link>
        </p>
      ) : null}
      <p className="home-kicker">Total</p>
      <p className="home-price">{formatMoney(snapshot.totalCents)}</p>
      {deposit ? (
        <p className="home-sub home-center">
          {closed ? "Deposit" : "Deposit due on sign"} · {formatMoney(deposit.amountCents)}
        </p>
      ) : null}
      <div className="home-scope">
        {snapshot.sections.map((section) => (
          <section key={section.name}>
            <h2>{section.name}</h2>
            <ul>
              {section.lines.map((line) => (
                <li key={`${section.name}-${line.name}`}>
                  <span>
                    {line.name}
                    {line.kind === "optional" ? <span className="home-sub">Optional</span> : null}
                    {line.kind === "allowance" ? <span className="home-sub">Allowance</span> : null}
                    {!line.kind ? (
                      <span className="home-sub">
                        {line.qty} {line.unit}
                      </span>
                    ) : null}
                  </span>
                  <span className="home-money">{formatMoney(line.priceCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!closed ? (
        <>
          <section className="home-steps" aria-label="Next steps">
            <h2>Next steps</h2>
            <ol>
              <li>Review the scope</li>
              <li>Sign to approve</li>
              <li>Pay the deposit</li>
            </ol>
          </section>
          <section className="home-sign">
            <h2>Sign</h2>
            <ActionForm action={signAction.bind(null, token)} className="home-form">
              <label>
                Legal name
                <input name="signerName" required className="home-input" defaultValue={snapshot.clientName} />
              </label>
              <label>
                Type your name to sign
                <input name="typedName" required className="home-input" placeholder={snapshot.clientName} />
              </label>
              <label>
                Email for a copy
                <input name="email" type="email" className="home-input" defaultValue={data.contact?.email ?? ""} />
              </label>
              <SignaturePad />
              <label className="home-check">
                <input type="checkbox" name="consent" required />
                <span>{CONSENT_TEXT}</span>
              </label>
              <button type="submit" className="home-btn">
                Sign proposal
              </button>
            </ActionForm>
            <ActionForm action={declineAction.bind(null, token)} className="home-form">
              <input name="reason" className="home-input" placeholder="Reason" aria-label="Reason" />
              <button type="submit" className="home-text">
                Decline this proposal
              </button>
            </ActionForm>
          </section>
        </>
      ) : null}
    </main>
  );
}
