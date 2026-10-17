import {
  acceptVendorPoAction,
  declineVendorPoAction,
  markVendorPunchAction,
  respondPortalCreditAction,
  vendorConfirmAction,
  saveVendorCertificateAction,
  signVendorWaiverAction,
  submitVendorBillAction,
  uploadVendorJobFileAction,
} from "@/app/actions";
import { submitPortalPayAppAction } from "@/app/(office)/pay-applications/actions";
import { markPortalObservationAction } from "@/app/(office)/observations/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { formatCalendarDay } from "@/lib/format";
import { addCalendarDays } from "@/lib/time/calendar";
import { formatMoney, formatWhole } from "@/lib/money";
import { CERT_TYPES } from "@/lib/vendor/compliance";
import { RfiPortal } from "@/components/rfi-portal";
import { SubmittalPortal } from "@/components/submittal-portal";
import type { PortalSubmittal } from "@/lib/services/submittals";
import type { VendorBidCard } from "@/lib/services/bids";
import type { PortalRfi } from "@/lib/services/rfis";
import type { VendorPortalHome } from "@/lib/services/vendor-portal";
import { submitVendorBidAction, declineVendorBidAction, vendorTickAction } from "@/app/actions";
import type { PortalMeeting } from "@/lib/services/meetings";
import type { PortalChangeQuote } from "@/lib/services/change-events";
import { submitChangeQuoteAction } from "@/app/(office)/change-events/actions";
import type { PortalTransmittal } from "@/lib/services/transmittals";
import type { VendorTodo } from "@/lib/services/todos";
import type { PortalWaiver } from "@/lib/services/waivers";
import type { VendorFileJob } from "@/lib/services/files";

function when(row: { startDate: string; endDate: string; startTime: string | null }) {
  const days = row.startDate === row.endDate ? formatCalendarDay(row.startDate) : `${formatCalendarDay(row.startDate)} – ${formatCalendarDay(row.endDate)}`;
  return row.startTime ? `${days} · ${row.startTime}` : days;
}

function dollars(cents: number | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function VendorPortalView({
  token,
  home,
  bids,
  rfis = [],
  todos = [],
  meetings = [],
  transmittals = [],
  changeQuotes = [],
  inspections = [],
  submittals = { items: [], jobs: [] },
  waivers = [],
  files = [],
  pins = [],
  weeks = 2,
}: {
  token: string;
  home: VendorPortalHome;
  bids: VendorBidCard[];
  rfis?: PortalRfi[];
  todos?: VendorTodo[];
  meetings?: PortalMeeting[];
  transmittals?: PortalTransmittal[];
  changeQuotes?: PortalChangeQuote[];
  inspections?: { name: string; date: string; result: string }[];
  submittals?: { items: PortalSubmittal[]; jobs: { id: string; name: string }[] };
  waivers?: PortalWaiver[];
  files?: VendorFileJob[];
  pins?: { id?: string; projectId?: string; title?: string; linkType: string; linkId: string; cropDocumentId: string | null }[];
  weeks?: 2 | 4;
}) {
  const horizon = addCalendarDays(home.today, (weeks === 4 ? 28 : 14) - 1);
  const lookahead = home.schedule.filter((row) => row.endDate >= home.today && row.startDate <= horizon);
  return (
    <main className="home mx-auto min-h-screen w-full max-w-5xl px-4 py-8 lg:px-8" data-today={home.today}>
      <header>
        <p className="home-company">{home.company}</p>
        <h1 className="home-title">{home.vendorName}</h1>
        {home.fields?.length ? (
          <dl aria-label="Fields">
            {home.fields.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>
      <section className="home-strip vendor-strip" aria-label="Totals">
        <div>
          <p>Open POs</p>
          <p className="home-figure" data-open-pos={home.openPos}>
            {home.openPos}
          </p>
        </div>
        <div>
          <p>Open commitment</p>
          <p className="home-figure" data-commitment={home.commitmentCents}>
            {formatWhole(home.commitmentCents)}
          </p>
        </div>
        <div>
          <p>Billed</p>
          <p className="home-figure" data-billed={home.billedCents}>
            {formatWhole(home.billedCents)}
          </p>
        </div>
        <div>
          <p>Paid</p>
          <p className="home-figure" data-paid={home.paidCents}>
            {formatWhole(home.paidCents)}
          </p>
        </div>
        <div>
          <p>Bids</p>
          <p className="home-figure" data-bids={bids.filter((bid) => bid.editable).length}>
            {bids.filter((bid) => bid.editable).length}
          </p>
        </div>
      </section>
      {meetings.length > 0 ? (
        <section className="mt-7" aria-label="Meetings">
          <h2>Meetings</h2>
          <ul className="home-stack">
            {meetings.map((meeting) => (
              <li key={meeting.id} className="home-card">
                <p className="home-copy">
                  {meeting.title} · {meeting.job}
                </p>
                <p className="home-sub">
                  {meeting.kindLabel} · {formatCalendarDay(meeting.meetOn)}
                </p>
                {meeting.items.map((item) => (
                  <p key={item.id} className="home-sub">
                    {item.title}
                    {item.decision ? ` · ${item.decision}` : ""}
                  </p>
                ))}
                {meeting.actions.map((action) => (
                  <p key={action.id} data-action={action.title}>
                    {action.title}
                    {action.dueOn ? ` · ${formatCalendarDay(action.dueOn)}` : ""} · {action.status === "done" ? "Done" : "Open"}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {changeQuotes.length > 0 ? (
        <section className="mt-7" aria-label="Change prices">
          <h2>Change prices</h2>
          <ul className="home-stack">
            {changeQuotes.map((quote) => (
              <li key={quote.id} className="home-card" data-quote={quote.title}>
                <p className="home-copy">{quote.title}</p>
                <p className="home-sub">
                  {quote.job} · {quote.number} · {quote.scope}
                  {quote.dueOn ? ` · ${formatCalendarDay(quote.dueOn)}` : ""}
                </p>
                {quote.files.map((file) => (
                  <p key={file.id} className="home-sub">
                    <a href={file.href}>{file.filename}</a>
                  </p>
                ))}
                {quote.status === "priced" ? (
                  <p className="home-sub num">
                    {quote.amountCents == null ? "" : formatWhole(quote.amountCents)} · {quote.days ?? 0}d {quote.note}
                  </p>
                ) : (
                  <ActionForm action={submitChangeQuoteAction.bind(null, token, quote.id)} className="home-form">
                    <label className="text-sm">
                      Amount
                      <input name="amount" aria-label={`Amount ${quote.title}`} inputMode="decimal" className="field mt-1" />
                    </label>
                    <label className="text-sm">
                      Days
                      <input name="days" aria-label={`Days ${quote.title}`} inputMode="numeric" className="field mt-1" />
                    </label>
                    <label className="text-sm">
                      Note
                      <input name="note" aria-label={`Note ${quote.title}`} className="field mt-1" />
                    </label>
                    <button type="submit" className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
                      Send price
                    </button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {transmittals.length > 0 ? (
        <section className="mt-7" aria-label="Transmittals">
          <h2>Transmittals</h2>
          <ul className="home-stack">
            {transmittals.map((row) => (
              <li key={row.id} className="home-card">
                <p className="home-copy">
                  <a href={row.href}>{row.subject}</a>
                </p>
                <p className="home-sub">
                  {row.job} · {row.number} · {row.statusLabel}
                  {row.dueOn ? ` · ${formatCalendarDay(row.dueOn)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="mt-7" aria-label="To-dos">
        <h2>To-dos</h2>
        {todos.length === 0 ? <p className="home-sub">No to-dos</p> : null}
        <ul className="home-stack">
          {todos.map((todo) => (
            <li key={todo.id} className="home-card" data-todo={todo.title}>
              <p className="home-copy">{todo.title}</p>
              <p className="home-sub">{[todo.job, todo.dueAt ? formatCalendarDay(todo.dueAt) : ""].filter(Boolean).join(" · ")}</p>
              <ActionForm action={vendorTickAction.bind(null, token, todo.id)} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="done" value={todo.status === "done" ? "0" : "1"} />
                <button type="submit" role="checkbox" aria-checked={todo.status === "done"} aria-label={todo.title} className="h-11 rounded-lg bg-[var(--fl-accent)] text-sm font-semibold text-white">
                  {todo.status === "done" ? "Reopen" : "Done"}
                </button>
                <FileButton name="photo" label={`Photo ${todo.title}`} accept="image/jpeg,image/png,image/webp" empty="Photo" />
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>
      <div className="home-main mt-7">
        <section aria-label="Bids">
          <h2>Bids</h2>
          {bids.length === 0 ? <p className="home-sub">No bids</p> : null}
          <ul className="home-stack">
            {bids.map((bid) => (
              <li key={bid.id} className="home-card" data-bid-title={bid.title}>
                <div className="home-row">
                  <div>
                    <p className="home-copy">{bid.title}</p>
                    <p className="home-sub">
                      {bid.job}
                      {bid.address ? ` · ${bid.address}` : ""} · {formatCalendarDay(bid.dueOn)}
                    </p>
                  </div>
                  <span className="home-pill">{bid.responseLabel}</span>
                </div>
                {bid.scope ? <p className="home-sub mt-2">{bid.scope}</p> : null}
                {bid.editable ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <ActionForm action={submitVendorBidAction.bind(null, token, bid.id)} className="home-form">
                      {bid.lines.map((line) => (
                        <div key={line.id}>
                          <p className="home-sub">
                            {line.costCode}
                            {line.description ? ` · ${line.description}` : ""} · {line.qtyMilli / 1000} {line.unit}
                          </p>
                          <input type="hidden" name="lineId" value={line.id} />
                          <label className="text-sm">
                            Unit price
                            <input name="unitPrice" inputMode="decimal" defaultValue={dollars(line.unitPriceCents)} aria-label={`Price ${line.costCode} ${bid.title}`} className="home-input" />
                          </label>
                          <label className="home-sub">
                            <input type="checkbox" name="noBid" value={line.id} defaultChecked={line.noBid} aria-label={`No bid ${line.costCode} ${bid.title}`} /> No bid
                          </label>
                        </div>
                      ))}
                      <label className="text-sm">
                        Note
                        <input name="note" defaultValue={bid.note} aria-label={`Note ${bid.title}`} className="home-input" />
                      </label>
                      <label className="text-sm">
                        Name
                        <input name="name" required defaultValue={bid.name} aria-label={`Name ${bid.title}`} className="home-input" />
                      </label>
                      <FileButton name="file" label={`File ${bid.title}`} accept="image/jpeg,image/png,image/webp" empty="File" />
                      <button type="submit" className="home-btn">
                        Send {bid.title}
                      </button>
                    </ActionForm>
                    <ActionForm action={declineVendorBidAction.bind(null, token, bid.id)} className="home-form">
                      <label className="text-sm">
                        Reason
                        <input name="reason" required aria-label={`Decline reason ${bid.title}`} className="home-input" />
                      </label>
                      <button type="submit" className="home-btn-quiet">
                        Decline {bid.title}
                      </button>
                    </ActionForm>
                  </div>
                ) : (
                  <ul className="mt-2">
                    {bid.lines.map((line) => (
                      <li key={line.id} className="home-sub">
                        {line.costCode} · {line.noBid ? "No bid" : line.unitPriceCents == null ? "—" : formatMoney(line.unitPriceCents)}
                      </li>
                    ))}
                  </ul>
                )}
                {bid.plans.length > 0 ? (
                  <ul className="mt-2">
                    {bid.plans.map((plan) => (
                      <li key={plan.id}>
                        <a href={`/api/files/${plan.id}?vendor=${encodeURIComponent(token)}`}>{plan.filename}</a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Orders">
          <h2>Orders</h2>
          {home.orders.length === 0 ? <p className="home-sub">No open orders</p> : null}
          <ul className="home-stack">
            {home.orders.map((order) => (
              <li key={order.id} className="home-card" data-po={order.number}>
                <div className="home-row">
                  <div>
                    <p className="home-copy">{order.number}</p>
                    <p className="home-sub">
                      {order.kind === "work" ? "Work order" : "Purchase order"} · {order.job} · {formatMoney(order.amountCents)}
                    </p>
                  </div>
                  <span className="home-pill">{order.response === "issued" ? "Issued" : order.response === "accepted" ? "Accepted" : "Declined"}</span>
                </div>
                <ul className="mt-2">
                  {order.lines.map((line) => (
                    <li key={line.costCode} className="home-sub">
                      {line.costCode}
                      {line.description ? ` · ${line.description}` : ""} · {formatMoney(line.amountCents)}
                    </li>
                  ))}
                </ul>
                {order.plans.length > 0 ? (
                  <ul className="mt-2">
                    {order.plans.map((plan) => (
                      <li key={plan.documentId}>
                        <a href={`/api/files/${plan.documentId}?vendor=${encodeURIComponent(token)}`}>{plan.name}</a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {order.response === "issued" ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <ActionForm action={acceptVendorPoAction.bind(null, token, order.id)} className="home-form">
                      <label className="text-sm">
                        Name
                        <input name="name" required aria-label={`Name ${order.number}`} className="home-input" />
                      </label>
                      <button type="submit" className="home-btn">
                        Accept {order.number}
                      </button>
                    </ActionForm>
                    <ActionForm action={declineVendorPoAction.bind(null, token, order.id)} className="home-form">
                      <label className="text-sm">
                        Reason
                        <input name="reason" required aria-label={`Reason ${order.number}`} className="home-input" />
                      </label>
                      <button type="submit" className="home-btn-quiet">
                        Decline {order.number}
                      </button>
                    </ActionForm>
                  </div>
                ) : null}
                {order.response === "accepted" && !order.progress ? (
                  <ActionForm action={submitVendorBillAction.bind(null, token, order.id)} className="home-form">
                    <label className="text-sm">
                      Bill number
                      <input name="billNumber" required aria-label={`Bill number ${order.number}`} className="home-input" />
                    </label>
                    <label className="text-sm">
                      Bill date
                      <input name="billDate" type="date" required defaultValue={home.today} aria-label={`Bill date ${order.number}`} className="home-input" />
                    </label>
                    <label className="text-sm">
                      Due
                      <input name="dueDate" type="date" defaultValue={home.today} aria-label={`Due ${order.number}`} className="home-input" />
                    </label>
                    {order.lines.map((line) => (
                      <label key={line.costCode} className="text-sm">
                        {line.costCode}
                        <input type="hidden" name="lineCode" value={line.costCode} />
                        <input name="lineAmount" inputMode="decimal" aria-label={`Amount ${line.costCode}`} className="home-input" />
                      </label>
                    ))}
                    <FileButton name="file" label={`File ${order.number}`} accept="image/jpeg,image/png,image/webp" empty="File" />
                    <button type="submit" className="home-btn">
                      Send bill
                    </button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Pay applications">
          <h2>Pay applications</h2>
          {home.payApps.length === 0 ? <p className="home-sub">0</p> : null}
          <ul className="home-stack">
            {home.payApps.map((app) => (
              <li key={app.id} className="home-card" data-pay-app={app.poNumber}>
                <div className="home-row">
                  <p className="home-copy">
                    {app.poNumber} {app.number}
                  </p>
                  <span className="home-pill">{app.statusLabel}</span>
                </div>
                <p className="home-sub num">{app.periodEnd}</p>
                {app.lines.map((line) => (
                  <p key={line.id} className="home-sub">
                    {line.costCode} · {formatMoney(line.thisPeriodCents)}
                    {line.rejectNote ? ` · ${line.rejectNote}` : ""}
                  </p>
                ))}
                {app.editable ? (
                  <ActionForm action={submitPortalPayAppAction.bind(null, token, app.id)} className="home-form">
                    {app.lines.map((line) => (
                      <div key={line.purchaseOrderLineId}>
                        <input type="hidden" name="lineId" value={line.purchaseOrderLineId} />
                        <label className="text-sm">
                          This period {line.costCode}
                          <input
                            name={`this_${line.purchaseOrderLineId}`}
                            aria-label={`This period ${line.costCode}`}
                            defaultValue={(line.thisPeriodCents / 100).toFixed(2)}
                            className="home-input"
                          />
                        </label>
                        <label className="text-sm">
                          Stored {line.costCode}
                          <input
                            name={`stored_${line.purchaseOrderLineId}`}
                            aria-label={`Stored ${line.costCode}`}
                            defaultValue={(line.storedCents / 100).toFixed(2)}
                            className="home-input"
                          />
                        </label>
                        <label className="text-sm">
                          Released {line.costCode}
                          <input
                            name={`released_${line.purchaseOrderLineId}`}
                            aria-label={`Released ${line.costCode}`}
                            defaultValue={(line.releasedCents / 100).toFixed(2)}
                            className="home-input"
                          />
                        </label>
                      </div>
                    ))}
                    <button type="submit" className="home-btn">
                      Submit pay app
                    </button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Observations">
          <h2>Observations</h2>
          {home.observations.length === 0 ? <p className="home-sub">0</p> : null}
          <ul className="home-stack">
            {home.observations.map((item) => (
              <li key={item.id} className="home-card" data-observation={item.title}>
                <div className="home-row">
                  <p className="home-copy">
                    {item.number} {item.title}
                  </p>
                  <span className="home-pill">{item.statusLabel}</span>
                </div>
                <p className="home-sub">
                  {item.job} · {item.typeLabel} · {item.priorityLabel}
                  {item.dueDate ? ` · ${item.dueDate}` : ""}
                </p>
                {item.hazard ? <p className="home-sub">{item.hazard}</p> : null}
                {item.description ? <p className="home-sub">{item.description}</p> : null}
                {item.rejectNote ? <p className="home-sub">{item.rejectNote}</p> : null}
                <ActionForm action={markPortalObservationAction.bind(null, token, item.id)} className="home-form">
                  <label className="text-sm">
                    Note
                    <textarea name="note" aria-label={`Note ${item.title}`} className="home-input" />
                  </label>
                  <FileButton name="photo" label={`Photo ${item.title}`} accept="image/jpeg,image/png,image/webp" empty="Photo" />
                  <button type="submit" className="home-btn">
                    Ready for review
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Files">
          <h2>Files</h2>
          {files.length === 0 ? <p className="home-sub">No files</p> : null}
          {files.map((job) => (
            <div key={job.projectId} className="mt-3">
              <p className="home-copy">{job.projectName}</p>
              {job.folders.map((folder) => (
                <div key={folder.name} className="home-card mt-2">
                  <p className="home-sub">{folder.name}</p>
                  <ul>
                    {folder.files.map((file) => (
                      <li key={file.documentId}>
                        <a href={`/api/files/${file.documentId}?vendor=${encodeURIComponent(token)}`}>{file.name}</a>
                        <span className="home-sub"> · Rev {file.revision} · {file.sizeLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <ActionForm action={uploadVendorJobFileAction.bind(null, token)} className="home-form mt-2">
                <input type="hidden" name="projectId" value={job.projectId} />
                <FileButton name="file" label={`File ${job.projectName}`} accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" empty="File" />
                <button type="submit" className="home-btn">
                  Upload
                </button>
              </ActionForm>
            </div>
          ))}
        </section>
        <section aria-label="Lien waivers">
          <h2>Lien waivers</h2>
          {waivers.length === 0 ? <p className="home-sub">None open</p> : null}
          <ul className="home-stack">
            {waivers.map((waiver) => (
              <li key={waiver.id} className="home-card">
                <p className="home-copy">{waiver.typeLabel}</p>
                <p className="home-sub">
                  {waiver.billNumber} · {waiver.job} · {formatMoney(waiver.amountCents)} · {formatCalendarDay(waiver.throughDate)}
                </p>
                <p className="mt-2 text-sm">{waiver.text}</p>
                <ActionForm action={signVendorWaiverAction.bind(null, token, waiver.id)} className="home-form mt-3">
                  <label className="text-sm">
                    Name
                    <input name="name" required aria-label={`Sign ${waiver.billNumber}`} className="home-input" />
                  </label>
                  <button type="submit" className="home-btn">
                    Sign {waiver.billNumber}
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
        {inspections.length > 0 ? (
          <section aria-label="Inspections">
            <h2>Inspections</h2>
            <ul className="home-stack">
              {inspections.map((row) => (
                <li key={`${row.name}-${row.date}`} className="home-card">
                  <p className="home-copy">{row.name}</p>
                  <p className="home-sub">
                    {row.date ? formatCalendarDay(row.date) : ""}
                    {row.date ? " · " : ""}
                    {row.result}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-label="Look-ahead" data-lookahead={weeks}>
          <div className="home-row">
            <h2>Look-ahead</h2>
            <span className="flex gap-2">
              <a href={`/v/${token}`} aria-current={weeks === 2 ? "page" : undefined} className="home-pill">
                2
              </a>
              <a href={`/v/${token}?weeks=4`} aria-current={weeks === 4 ? "page" : undefined} className="home-pill">
                4
              </a>
            </span>
          </div>
          {lookahead.length === 0 ? <p className="home-sub">No days</p> : null}
          <ul className="home-stack">
            {lookahead.map((row) => {
              const plans = files
                .filter((job) => job.projectId === row.projectId)
                .flatMap((job) => job.folders.flatMap((folder) => folder.files.filter((file) => file.current)));
              const marks = pins.filter((pin) => pin.projectId === row.projectId);
              return (
                <li key={row.id} className="home-card" data-item={row.id}>
                  <div className="home-row">
                    <div>
                      <p className="home-copy">{row.title}</p>
                      <p className="home-sub">
                        {row.job}
                        {row.address ? ` · ${row.address}` : ""} · {when(row)}
                      </p>
                    </div>
                    <span className="flex gap-1">
                      {row.pill ? <span className="home-pill">{row.pill}</span> : null}
                      <span className="home-pill">{row.cleared ? "Clear" : row.gate || "Held"}</span>
                    </span>
                  </div>
                  {row.status === "declined" && row.reason ? <p className="home-sub">{row.reason}{row.proposed ? ` · ${formatCalendarDay(row.proposed)}` : ""}</p> : null}
                  {plans.length > 0 ? (
                    <ul>
                      {plans.map((plan) => (
                        <li key={plan.documentId}>
                          <a href={`/api/files/${plan.documentId}?vendor=${encodeURIComponent(token)}`}>{plan.name}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {marks.length > 0 ? (
                    <ul>
                      {marks.map((pin) => (
                        <li key={pin.id || pin.linkId}>{pin.title}</li>
                      ))}
                    </ul>
                  ) : null}
                  {row.status === "requested" ? (
                    <div className="flex flex-col gap-2">
                      <ActionForm action={vendorConfirmAction.bind(null, token, row.id)}>
                        <input type="hidden" name="decision" value="confirm" />
                        <button type="submit" className="home-btn-quiet">
                          Confirm
                        </button>
                      </ActionForm>
                      <ActionForm action={vendorConfirmAction.bind(null, token, row.id)} className="home-form">
                        <input type="hidden" name="decision" value="decline" />
                        <input name="reason" aria-label={`Reason ${row.title}`} placeholder="Reason" className="field" required />
                        <input name="proposed" aria-label={`Proposed date ${row.title}`} type="date" className="field" />
                        <button type="submit" className="home-btn-quiet">
                          Decline
                        </button>
                      </ActionForm>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-label="Credits">
          <h2>Credits</h2>
          {home.credits.length === 0 ? <p className="home-sub">No credits</p> : null}
          <ul className="home-stack">
            {home.credits.map((credit) => (
              <li key={credit.id} className="home-card">
                <div className="home-row">
                  <span>{credit.number}</span>
                  <span className="fl-pill">{credit.statusLabel}</span>
                </div>
                <p className="home-sub">
                  {credit.job} · {credit.reason} · <span className="num">{formatWhole(credit.amountCents)}</span>
                </p>
                {credit.documentId ? (
                  <a href={`/api/files/${credit.documentId}?vendor=${encodeURIComponent(token)}`}>Photo</a>
                ) : null}
                {credit.disputeNote ? <p className="home-sub">{credit.disputeNote}</p> : null}
                {credit.canRespond ? (
                  <div className="flex flex-col gap-2">
                    <ActionForm action={respondPortalCreditAction.bind(null, token, credit.id)}>
                      <input type="hidden" name="decision" value="acknowledge" />
                      <button type="submit" className="home-btn-quiet">
                        Acknowledge
                      </button>
                    </ActionForm>
                    <ActionForm action={respondPortalCreditAction.bind(null, token, credit.id)} className="home-form">
                      <input type="hidden" name="decision" value="dispute" />
                      <input name="note" aria-label={`Dispute ${credit.number}`} placeholder="Note" className="field" required />
                      <button type="submit" className="home-btn-quiet">
                        Dispute
                      </button>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Punch">
          <h2>Punch</h2>
          {home.punch.length === 0 ? <p className="home-sub">No items</p> : null}
          <ul className="home-stack">
            {home.punch.map((item) => (
              <li key={item.id} className="home-card">
                <div className="home-row">
                  <div>
                    <p className="home-copy">{item.title}</p>
                    <p className="home-sub">{[item.location, item.dueDate ? formatCalendarDay(item.dueDate) : ""].filter(Boolean).join(" · ")}</p>
                    {pins.find((pin) => pin.linkType === "punch" && pin.linkId === item.id)?.cropDocumentId ? (
                      <img src={`/api/files/${pins.find((pin) => pin.linkType === "punch" && pin.linkId === item.id)?.cropDocumentId}?vendor=${encodeURIComponent(token)}`} alt="" className="mt-2 h-24 w-36 rounded-lg object-cover" />
                    ) : null}
                  </div>
                  <span className="home-pill">{item.statusLabel}</span>
                </div>
                {item.status === "open" ? (
                  <ActionForm action={markVendorPunchAction.bind(null, token, item.id)} className="home-form">
                    <FileButton name="photo" label={`Photo ${item.title}`} accept="image/jpeg,image/png,image/webp" empty="Photo" />
                    <button type="submit" className="home-btn-quiet">
                      Mark {item.title} done
                    </button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Bills">
          <h2>Bills</h2>
          {home.bills.length === 0 ? <p className="home-sub">No bills</p> : null}
          <ul className="home-stack">
            {home.bills.map((bill) => (
              <li key={bill.id} className="home-card" data-bill={bill.number}>
                <div className="home-row">
                  <div>
                    <p className="home-copy">{bill.number}</p>
                    <p className="home-sub">
                      {formatMoney(bill.amountCents)}
                      {bill.billDate ? ` · ${formatCalendarDay(bill.billDate)}` : ""}
                      {` · Paid ${formatMoney(bill.paidCents)} · Retained ${formatMoney(bill.retainedCents)} · Released ${formatMoney(bill.releasedCents)}`}
                    </p>
                  </div>
                  <span className="home-pill">{bill.statusLabel}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <RfiPortal
          token={token}
          items={rfis}
          side="vendor"
          crops={Object.fromEntries(pins.filter((pin) => pin.linkType === "rfi" && pin.cropDocumentId).map((pin) => [pin.linkId, pin.cropDocumentId]))}
        />
        <SubmittalPortal token={token} items={submittals.items} jobs={submittals.jobs} side="vendor" />
        <section aria-label="Certificates">
          <h2>Certificates</h2>
          <ul className="home-stack">
            {home.certificates.map((row) => (
              <li key={row.type} className="home-card" data-cert={row.type}>
                <div className="home-row">
                  <p className="home-copy">{row.label}</p>
                  <span className="home-pill">{row.statusLabel}</span>
                </div>
              </li>
            ))}
          </ul>
          <ActionForm action={saveVendorCertificateAction.bind(null, token)} className="home-form">
            <label className="text-sm">
              Type
              <select name="type" aria-label="Certificate type" className="home-input" defaultValue="workers_comp">
                {CERT_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Expires
              <input name="expiresOn" type="date" required aria-label="Expires" className="home-input" />
            </label>
            <FileButton name="file" label="Certificate file" accept="image/jpeg,image/png,image/webp" empty="File" />
            <button type="submit" className="home-btn">
              Save certificate
            </button>
          </ActionForm>
        </section>
      </div>
    </main>
  );
}
