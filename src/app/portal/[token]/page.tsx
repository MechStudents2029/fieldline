import Link from "next/link";
import { notFound } from "next/navigation";
import { approveCoAction, chooseSelectionAction, portalMessageAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { PhotoLightbox } from "@/components/portal/photo-lightbox";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { CONSENT_TEXT } from "@/lib/product";
import {
  depositPaidAt,
  finalInvoiceAt,
  homeownerOrders,
  invoiceTypeLabel,
  needsYouAction,
  portalMoney,
  portalTimeline,
  sentenceStatus,
} from "@/lib/portal/summary";
import { PortalWarrantySection } from "@/components/portal-warranty";
import { portalBilling } from "@/lib/services/draws";
import { portalByToken } from "@/lib/services/read";
import { portalWarranty } from "@/lib/services/punch";
import { RfiPortal } from "@/components/rfi-portal";
import { clientPortalRfis } from "@/lib/services/rfis";
import { portalSelections, type PortalSelection } from "@/lib/services/selections";

export const dynamic = "force-dynamic";

function portalStarted() {
  return Date.now();
}

function formatDelta(cents: number): string {
  const amount = formatMoney(Math.abs(cents));
  if (cents < 0) return `−${amount}`;
  if (cents > 0) return `+${amount}`;
  return amount;
}

function photoSrc(id: string, token: string) {
  return `/api/files/${id}?portal=${encodeURIComponent(token)}`;
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (process.env.FIELDLINE_E2E === "1" && token === "e2e-crash") throw new Error("E2E portal crash check");
  const data = portalByToken(token);
  if (!data?.org || !data.contact) notFound();

  const orders = homeownerOrders(data.orders);
  const money = portalMoney({
    proposalStatus: data.proposal?.status ?? null,
    proposalTotalCents: data.proposal?.totalCents ?? null,
    orders: data.orders,
    payments: data.payments,
  });
  const steps = portalTimeline({
    signedAt: data.proposal?.status === "signed" ? data.proposal.signedAt : null,
    depositPaidAt: depositPaidAt({ invoices: data.invoices, payments: data.payments }),
    logDates: data.logs.map((log) => log.logDate),
    finalInvoiceAt: finalInvoiceAt(data.invoices),
  });
  const billing = portalBilling(token);
  const selections = portalSelections(token) ?? [];
  const warranty = portalWarranty(token);
  const pendingSelections = selections.filter((selection) => selection.status === "released");
  const action = needsYouAction({ orders: data.orders, invoices: data.invoices });
  const featuredId = action?.kind === "change-order" ? action.id : null;
  const featured = featuredId ? orders.find((order) => order.id === featuredId) : null;
  const payInvoice = action?.kind === "invoice" ? data.invoices.find((invoice) => invoice.id === action.id) : null;
  const listed = orders.filter((order) => order.id !== featuredId);
  const approved = orders.filter((order) => order.status === "approved");

  return (
    <main className="home mx-auto min-h-screen w-full max-w-5xl px-4 py-8 lg:px-8">
      <header>
        <p className="home-company">{data.org.name}</p>
        <h1 className="home-title">{data.project.name}</h1>
        {data.project.address ? <p className="home-sub">{data.project.address}</p> : null}
      </header>

      <section className="home-strip" aria-label="Money">
        <div>
          <p>Contract</p>
          <p className="home-figure">{formatMoney(money.contractCents)}</p>
        </div>
        <div>
          <p>Paid</p>
          <p className="home-figure">{formatMoney(money.paidCents)}</p>
        </div>
        <div>
          <p>Balance</p>
          <p className="home-figure">{formatMoney(money.balanceCents)}</p>
        </div>
        {billing && billing.retainedCents > 0 ? (
          <div>
            <p>Retained</p>
            <p className="home-figure">{formatMoney(billing.retainedCents)}</p>
          </div>
        ) : null}
      </section>

      {featured || (!featured && payInvoice) || pendingSelections.length > 0 ? (
        <section className="home-needs" aria-label="Needs you">
          <h2>Needs you</h2>
          {featured ? <OrderCard order={featured} /> : null}
          {!featured && payInvoice ? (
            <>
              <p className="home-sub">
                {payInvoice.number} · Due {formatDate(payInvoice.dueDate)}
              </p>
              <Link className="home-btn" href={`/pay/${payInvoice.payToken}`}>
                Pay {formatMoney(payInvoice.totalCents)}
              </Link>
            </>
          ) : null}
          {pendingSelections.map((selection) => (
            <p key={selection.id} className="home-row">
              <Link className="home-link" href={`#selection-${selection.id}`}>
                {selection.title}
              </Link>
              {selection.area ? <span className="home-sub">{selection.area}</span> : null}
            </p>
          ))}
        </section>
      ) : null}

      <div className="home-split">
        {steps.length > 0 ? (
          <aside className="home-progress" aria-label="Progress">
            <h2>Progress</h2>
            <ol>
              {steps.map((step) => (
                <li key={step.id}>
                  <span>{step.label}</span>
                  <span className="home-money">{formatDate(step.date)}</span>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}

        <div className="home-main">
          <RfiPortal token={token} items={clientPortalRfis(token)} side="client" />
          {warranty && (warranty.closed || warranty.punch.length > 0) ? (
            <PortalWarrantySection token={token} home={warranty} startedAt={portalStarted()} />
          ) : null}
          {listed.length > 0 ? (
            <section aria-label="Change orders">
              <h2>Change orders</h2>
              <div className="home-stack">
                {listed.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            </section>
          ) : null}

          {billing && billing.draws.length > 0 ? (
            <section aria-label="Draws">
              <h2>Draws</h2>
              <div className="home-stack">
                {billing.draws.map((draw) => (
                  <article key={draw.id} className="home-card" data-draw={draw.title}>
                    <div className="home-row">
                      <div>
                        <p className="home-strong">{draw.title}</p>
                        <p className="home-sub">{draw.dueOn ? formatDate(draw.dueOn) : "—"}</p>
                      </div>
                      <div className="home-row-end">
                        <span className="home-pill">{draw.label}</span>
                        <span className="home-money">{formatMoney(draw.amountCents)}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {billing && billing.applications.some((invoice) => invoice.lines.length > 0) ? (
            <section aria-label="Pay applications">
              <h2>Pay applications</h2>
              <div className="home-stack">
                {billing.applications
                  .filter((invoice) => invoice.lines.length > 0)
                  .map((invoice) => (
                    <article key={invoice.id} className="home-card">
                      <div className="home-row">
                        <p className="home-strong">
                          {invoice.number} · {invoice.applicationNumber}
                        </p>
                        <span className="home-money">{formatMoney(invoice.totalCents)}</span>
                      </div>
                      <table className="mt-2 w-full text-left">
                        <tbody>
                          {invoice.lines.map((line) => (
                            <tr key={line.name}>
                              <th scope="row" className="home-sub py-1 text-left font-normal">
                                {line.name}
                              </th>
                              <td className="home-sub num py-1 text-right">{formatMoney(line.scheduledCents)}</td>
                              <td className="home-sub num py-1 text-right">{formatMoney(line.thisCents)}</td>
                              <td className="home-sub num py-1 text-right">{formatMoney(line.balanceCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </article>
                  ))}
              </div>
            </section>
          ) : null}

          {data.invoices.length > 0 ? (
            <section aria-label="Invoices">
              <h2>Invoices</h2>
              <div className="home-stack">
                {data.invoices.map((invoice) => (
                  <article key={invoice.id} className="home-card">
                    <div className="home-row">
                      <div>
                        <p className="home-strong">{invoice.number}</p>
                        <p className="home-sub">
                          {invoiceTypeLabel(invoice.type)} · Due {formatDate(invoice.dueDate)}
                        </p>
                      </div>
                      <div className="home-row-end">
                        <span className="home-pill">{sentenceStatus(invoice.status)}</span>
                        <span className="home-money">{formatMoney(invoice.totalCents)}</span>
                        {invoice.status === "open" || invoice.status === "draft" ? (
                          <Link className="home-link" href={`/pay/${invoice.payToken}`}>
                            Pay
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {data.proposal?.status === "signed" || approved.length > 0 ? (
            <section aria-label="Documents">
              <h2>Documents</h2>
              <div className="home-stack">
                {data.proposal?.status === "signed" ? (
                  <article className="home-card">
                    <div className="home-row">
                      <div>
                        <p className="home-strong">Proposal</p>
                        <p className="home-sub">Signed {formatDate(data.proposal.signedAt)}</p>
                      </div>
                      <div className="home-row-end">
                        <span className="home-pill">Signed</span>
                        <Link className="home-link" href={`/p/${data.proposal.publicToken}`}>
                          View
                        </Link>
                      </div>
                    </div>
                  </article>
                ) : null}
                {approved.map((order) => (
                  <article key={order.id} className="home-card">
                    <div className="home-row">
                      <div>
                        <p className="home-strong">
                          CO {order.number} · {order.title}
                        </p>
                        <p className="home-sub">{orderHistory(order)}</p>
                      </div>
                      <span className="home-pill">Approved</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {data.logs.length > 0 ? (
            <section aria-label="Updates">
              <h2>Updates</h2>
              <div className="home-stack">
                {data.logs.map((log) => (
                  <article key={log.id} className="home-card">
                    <p className="home-sub">{formatDate(log.logDate)}</p>
                    {log.notes ? <p className="home-copy">{log.notes}</p> : null}
                    {log.plannedNext ? <p className="home-sub">Next · {log.plannedNext}</p> : null}
                    {log.photos.length > 0 ? (
                      <PhotoLightbox
                        photos={log.photos.map((photo) => ({
                          id: photo.id,
                          src: photoSrc(photo.id, token),
                          alt: photo.caption || "Photo",
                        }))}
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {selections.length > 0 ? (
            <section id="selections" aria-label="Selections">
              <h2>Selections</h2>
              <div className="home-stack">
                {selections.map((selection) => (
                  <SelectionCard key={selection.id} token={token} selection={selection} />
                ))}
              </div>
            </section>
          ) : null}

          <section aria-label="Messages">
            <h2>Messages</h2>
            {data.messages.length > 0 ? (
              <ul className="home-thread">
                {data.messages.map((message) => {
                  const photos = data.messagePhotos.filter((photo) => photo.messageId === message.id);
                  return (
                    <li key={message.id} className={message.direction === "in" ? "home-bubble mine" : "home-bubble"}>
                      <p className="home-sub">{message.direction === "in" ? "You" : data.org?.name}</p>
                      <p className="home-copy">{message.body}</p>
                      {photos.length > 0 ? (
                        <PhotoLightbox
                          photos={photos.map((photo) => ({
                            id: photo.id,
                            src: photoSrc(photo.id, token),
                            alt: "Photo",
                          }))}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <ActionForm action={portalMessageAction.bind(null, token)} className="home-form">
              <textarea name="body" rows={3} className="home-input" placeholder="Message" aria-label="Message" />
              <FileButton name="photo" label="Photo" accept="image/jpeg,image/png,image/webp" empty="Photo" />
              <button type="submit" className="home-btn">
                Send
              </button>
            </ActionForm>
          </section>
        </div>
      </div>
    </main>
  );
}

function SelectionCard({ token, selection }: { token: string; selection: PortalSelection }) {
  const chosen = selection.choices.find((choice) => choice.id === selection.chosenChoiceId) ?? null;
  return (
    <article className="home-card" id={`selection-${selection.id}`}>
      <div className="home-row">
        <div>
          <p className="home-strong">{selection.title}</p>
          {selection.area ? <p className="home-sub">{selection.area}</p> : null}
        </div>
        {chosen ? <span className="home-money">{chosen.deltaLabel}</span> : null}
        {selection.status === "locked" && !chosen ? <span className="home-sub">Locked</span> : null}
      </div>
      {selection.status === "released" ? (
        <ActionForm action={chooseSelectionAction.bind(null, token)} className="home-form">
          <input type="hidden" name="selectionId" value={selection.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            {selection.choices.map((choice) => (
              <label key={choice.id} className="home-card">
                <input type="radio" name="choiceId" value={choice.id} aria-label={choice.name} required />
                {choice.photoDocumentId ? (
                  <img src={photoSrc(choice.photoDocumentId, token)} alt="" className="aspect-[4/3] w-full rounded-md object-cover" />
                ) : (
                  <span className="block aspect-[4/3] w-full rounded-md bg-[var(--fl-fill)]" />
                )}
                <span className="home-row">
                  <span className="home-strong">{choice.name}</span>
                  <span className="home-money">{choice.deltaLabel}</span>
                </span>
                {choice.vendor ? <span className="home-sub">{choice.vendor}</span> : null}
              </label>
            ))}
          </div>
          <input name="typedName" className="home-input" placeholder="Type your name" aria-label="Type your name" />
          <label className="home-check">
            <input type="checkbox" name="consent" />
            <span>{CONSENT_TEXT}</span>
          </label>
          <button type="submit" className="home-btn">
            Confirm {selection.title}
          </button>
        </ActionForm>
      ) : chosen ? (
        <p className="home-strong">{chosen.name}</p>
      ) : null}
    </article>
  );
}

function orderHistory(order: { sentAt: string | null; approvedAt: string | null }) {
  const parts = [];
  if (order.sentAt) parts.push(`Sent ${formatDate(order.sentAt)}`);
  if (order.approvedAt) parts.push(`Approved ${formatDate(order.approvedAt)}`);
  return parts.join(" · ");
}

function OrderCard({
  order,
}: {
  order: {
    id: string;
    number: number;
    title: string;
    status: string;
    description: string | null;
    priceDeltaCents: number;
    publicToken: string;
  };
}) {
  return (
    <article className="home-card" id={`co-${order.id}`}>
      <div className="home-row">
        <div>
          <p className="home-strong">
            CO {order.number} · {order.title}
          </p>
          {order.description ? <p className="home-sub">{order.description}</p> : null}
        </div>
        <div className="home-row-end">
          <span className="home-pill">{sentenceStatus(order.status)}</span>
          <span className="home-money">{formatDelta(order.priceDeltaCents)}</span>
        </div>
      </div>
      {order.status === "sent" ? (
        <ActionForm action={approveCoAction.bind(null, order.publicToken)} className="home-form">
          <input name="typedName" className="home-input" placeholder="Type your name" aria-label="Type your name" />
          <label className="home-check">
            <input type="checkbox" name="consent" />
            <span>{CONSENT_TEXT}</span>
          </label>
          <button type="submit" className="home-btn">
            Approve change order
          </button>
        </ActionForm>
      ) : null}
    </article>
  );
}
