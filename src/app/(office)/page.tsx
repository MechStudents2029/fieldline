import Link from "next/link";
import { completeTaskAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle, PlusLink } from "@/components/ios";
import { Toolbar } from "@/components/mac/toolbar";
import { FirstProposal, SetupRow } from "@/components/setup-checklist";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { cashAlert } from "@/lib/services/cash";
import { formatCompact, formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm, canSeeMoney } from "@/lib/permissions";
import { companyChecklist, firstProposal } from "@/lib/services/onboarding";
import { dashboard, listInvoices, listProjects, pipelineBoard } from "@/lib/services/read";
import { MyDay } from "@/components/my-day";
import { WEBSITE_FORM_SOURCE } from "@/lib/lead-form/rules";
import { unseenWebLeadCount } from "@/lib/services/lead-form";
import { warrantyQueue } from "@/lib/services/punch";
import { vendorBillQueue, vendorCertificateQueue } from "@/lib/services/vendor-portal";
import { bidQueues } from "@/lib/services/bids";
import { readyToBill } from "@/lib/services/draws";
import { readyToPay, retainageHeldOnClosed } from "@/lib/services/pay-ready";
import { mentionUnread } from "@/lib/services/comments";
import { rfiQueue } from "@/lib/services/rfis";
import { submittalQueue } from "@/lib/services/submittals";
import { waiverQueue } from "@/lib/services/waivers";
import { DashboardStrip } from "@/components/dashboard-strip";
import { KpiTile } from "@/components/kpi-tile";
import { dashboardForRole } from "@/lib/services/dashboards";
import { underbilledSummary } from "@/lib/services/wip";
import { overdueTodoCount } from "@/lib/services/todos";
import { agedCostPlus } from "@/lib/services/cost-plus";
import { noticesFor } from "@/lib/services/automations";
import { safetyQueue } from "@/lib/services/safety";
import { equipmentQueue } from "@/lib/services/equipment";
import { inspectionQueue } from "@/lib/services/permits";
import { unconfirmedSoon } from "@/lib/services/confirmations";
import { unbilledTm } from "@/lib/services/tm";
import { slippedSchedule } from "@/lib/services/schedule-plan";
import { staleClientUpdates } from "@/lib/services/client-updates";
import { overdueSelections } from "@/lib/services/selections";
import { selectionsNeedingPo } from "@/lib/services/order-from";
import { timeBoard, weeklyOtWatch } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

function officeDay(timeZone: string) {
  return localDay(Date.now(), timeZone);
}

function longDate(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(new Date());
}

function dueWord(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  const today = localDay(Date.now(), timeZone);
  if (day === addCalendarDays(today, -1)) return "Yesterday";
  if (day < today) return "Late";
  if (day === today) return "Today";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

function elapsed(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours > 12) return { text: `Open ${hours}h`, forgotten: true };
  return { text: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`, forgotten: false };
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function shortJob(name: string) {
  return name.split(" ").slice(0, 2).join(" ");
}

type AttentionRow = { key: string; href: string; title: string; count: number; money: boolean; trailing: string; danger?: boolean };

function Attention({ rows }: { rows: AttentionRow[] }) {
  const primary = rows.filter((row) => row.money || row.count > 1);
  const rest = rows.filter((row) => !row.money && row.count <= 1);
  if (rows.length === 0) return null;
  const item = (row: AttentionRow) => (
    <GroupedRow key={row.key} href={row.href} title={row.title} trailing={<span className={row.danger ? "num text-[var(--mac-danger)]" : "num"}>{row.trailing}</span>} />
  );
  return (
    <div className="flex flex-col gap-2">
      {primary.length > 0 ? <ul className="fl-group">{primary.map(item)}</ul> : null}
      {rest.length > 0 ? (
        <details data-today-more>
          <summary className="fl-cell fl-group">
            <span className="min-w-0 flex-1">More</span>
            <span className="num">{rest.length}</span>
          </summary>
          <ul className="fl-group mt-2">{rest.map(item)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function KpiRow({ dashboard, kpis }: { dashboard: React.ReactNode; kpis: { label: string; value: string }[] }) {
  if (!dashboard && kpis.length === 0) return null;
  return (
    <div className="flex gap-3 overflow-x-auto" data-today-kpis>
      {dashboard}
      {kpis.map((item) => (
        <KpiTile key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  );
}

export default async function TodayPage() {
  const session = await requireSession();
  if (session.role === "field") return <MyDay actor={session} />;
  const data = dashboard(session.orgId);
  const money = canSeeMoney(session.role);
  const checklist = companyChecklist(session.orgId);
  const time = timeBoard(session);
  const board = pipelineBoard(session.orgId);
  const crew = time.office?.clockedIn ?? [];
  const showSetup = checklist && !checklist.facts.dismissed;
  const proposal = firstProposal(session.orgId);
  const draftLeadIds = new Set(data.drafts.map((draft) => draft.leadId));
  const needs: { key: string; href: string; title: string; subtitle?: string; trailing: string; late?: boolean }[] = [];
  for (const draft of data.drafts) {
    const lead = board.cards.find((card) => card.lead.id === draft.leadId)?.lead;
    needs.push({
      key: draft.id,
      href: "/follow-ups",
      title: draft.subject.split("—")[0]?.trim() || draft.subject,
      subtitle: draft.kind === "proposal_unsigned" ? "Proposal viewed, not signed" : "Quiet lead",
      trailing: money && lead?.valueEstCents ? formatWhole(lead.valueEstCents) : "",
    });
  }
  for (const row of data.marginAlerts) {
    needs.push({
      key: row.project.id,
      href: `/projects/${row.project.id}`,
      title: shortJob(row.project.name),
      subtitle: money ? `${formatWhole(row.actualCents)} of ${formatWhole(row.project.contractValueCents)}` : undefined,
      trailing: money ? formatPercent(row.marginBps) : "",
      late: true,
    });
  }
  for (const card of board.cards) {
    if (card.stage.kind !== "open" || draftLeadIds.has(card.lead.id)) continue;
    if (card.stage.name === "Estimate sent" || card.stage.name === "Negotiation") continue;
    if (!card.lead.valueEstCents) continue;
    needs.push({
      key: card.lead.id,
      href: `/leads/${card.lead.id}`,
      title: card.lead.title,
      subtitle: "Estimate draft",
      trailing: money ? formatWhole(card.lead.valueEstCents) : "",
    });
  }
  const webLeadCount = unseenWebLeadCount(session.orgId);
  const webLeadHref = `/pipeline?source=${encodeURIComponent(WEBSITE_FORM_SOURCE)}`;
  const warranty = warrantyQueue(session.orgId);
  const vendorBills = vendorBillQueue(session.orgId);
  const vendorCerts = vendorCertificateQueue(session.orgId);
  const bids = bidQueues(session.orgId);
  const ready = money ? readyToBill(session.orgId) : { count: 0, cents: 0, href: null as string | null };
  const payReady = money ? readyToPay(session.orgId, session.role) : { count: 0, cents: 0, href: null as string | null };
  const heldRetainage = money ? retainageHeldOnClosed(session.orgId, session.role) : { cents: 0, href: null as string | null };
  const rfis = rfiQueue(session);
  const submittals = submittalQueue(session);
  const waivers = money ? waiverQueue(session) : { count: 0, href: null };
  const mentions = mentionUnread(session);
  const under = canEditCrm(session.role) ? underbilledSummary(session) : { count: 0, cents: 0 };
  const overdueTodos = overdueTodoCount(session);
  const todayKey = officeDay(time.timeZone);
  const staleUpdates = staleClientUpdates(session.orgId, todayKey, time.timeZone);
  const agedCosts = money ? agedCostPlus(session.orgId, todayKey) : { count: 0, href: null as string | null };
  const scheduleSlip = canEditCrm(session.role) ? slippedSchedule(session.orgId) : { count: 0, href: null as string | null };
  const inspections = inspectionQueue(session.orgId, todayKey);
  const gear = equipmentQueue(session.orgId, todayKey);
  const notices = noticesFor(session);
  const safety = safetyQueue(session.orgId, todayKey);
  const lateSelections = overdueSelections(session.orgId, todayKey).map((row) => ({
    key: `sel_${row.id}`,
    href: `/projects/${row.projectId}/selections`,
    title: row.title,
    subtitle: shortJob(row.projectName),
    trailing: "Past due",
    late: true,
  }));
  const shown = [...lateSelections, ...needs].slice(0, 5);
  const quiet = shown.length === 0 && data.tasks.length === 0 && crew.length === 0;
  const projects = listProjects(session.orgId);
  const active = projects.filter((row) => row.project.status === "active" && row.marginBps != null);
  const avgMargin = active.length === 0 ? null : Math.round(active.reduce((sum, row) => sum + (row.marginBps ?? 0), 0) / active.length);
  const soon = addCalendarDays(todayKey, 14);
  const invoices = listInvoices(session.orgId);
  const cash = invoices.filter(({ invoice }) => invoice.status === "open" && invoice.dueDate.slice(0, 10) <= soon);
  const milestone = (projectId: string) => {
    const open = invoices
      .filter(({ invoice }) => invoice.projectId === projectId && invoice.status === "open")
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
    const next = open[0]?.invoice;
    if (!next) return undefined;
    const label = next.type.charAt(0).toUpperCase() + next.type.slice(1);
    return next.dueDate.slice(0, 10) < todayKey ? `${label} late` : `${label} due ${formatCalendarDay(next.dueDate)}`;
  };
  const home = dashboardForRole(session);
  const kpis = money
    ? [
        { label: "Pipeline", value: formatCompact(data.pipelineCents) },
        { label: "To collect", value: formatCompact(data.receivableCents) },
        { label: "On site", value: String(crew.length) },
        { label: "Avg margin", value: formatPercent(avgMargin) },
      ]
    : [];
  const attention: AttentionRow[] = [];
  const push = (key: string, count: number, href: string | null, title: string, trailing: string, moneyRow = false, danger = false) => {
    if (count > 0 && href) attention.push({ key, href, title, count, trailing, money: moneyRow, danger });
  };
  for (const notice of notices) attention.push({ key: notice.id, href: notice.href, title: notice.title, count: 2, trailing: "", money: false });
  push("talks", safety.missed.count, safety.missed.href, "Talks missed", String(safety.missed.count));
  push("checks", safety.failed.count, safety.failed.href, "Failed checks", String(safety.failed.count));
  push("incidents", safety.actions.count, safety.actions.href, "Open incidents", String(safety.actions.count));
  push("updates", staleUpdates.count, staleUpdates.href, "Client updates", String(staleUpdates.count));
  push("unbilled", agedCosts.count, agedCosts.href, "Unbilled costs", String(agedCosts.count));
  push("slip", scheduleSlip.count, scheduleSlip.href, "Schedule slip", String(scheduleSlip.count));
  const unconfirmed = unconfirmedSoon(session.orgId);
  const tm = money ? unbilledTm(session.orgId) : { count: 0, totalCents: 0, href: "/tm" };
  push("unconfirmed", unconfirmed.count, unconfirmed.count > 0 ? unconfirmed.href : null, `${unconfirmed.count} unconfirmed starting in ${unconfirmed.days} days`, String(unconfirmed.count));
  const toOrder = selectionsNeedingPo(session.orgId);
  push("sel-po", toOrder.length, toOrder[0]?.href ?? null, "Selections to order", String(toOrder.length));
  for (const watch of weeklyOtWatch(session)) {
    attention.push({ key: `ot-${watch.userId}`, href: "/time", title: `${watch.name} · weekly OT`, count: 1, trailing: watch.trailing, money: false });
  }
  push("tm", tm.count, tm.count > 0 ? tm.href : null, "Unbilled T&M", `${tm.count} · ${formatWhole(tm.totalCents)}`, true);
  push("inspections", inspections.upcoming.count, inspections.upcoming.href, "Inspections", String(inspections.upcoming.count));
  push("failed-inspections", inspections.failed.count, inspections.failed.href, "Failed inspections", String(inspections.failed.count));
  push("permits", inspections.expiring.count, inspections.expiring.href, "Permits expiring", String(inspections.expiring.count));
  push("returns", gear.overdue.count, gear.overdue.href, "Overdue returns", String(gear.overdue.count));
  push("service", gear.service.count, gear.service.href, "Service due", String(gear.service.count));
  push("stranded", gear.stranded.count, gear.stranded.href, "Left on closed jobs", String(gear.stranded.count));
  push("todos", overdueTodos, overdueTodos > 0 ? "/todos?due=overdue" : null, "Overdue to-dos", String(overdueTodos));
  push("under", under.count, under.count > 0 ? "/reports/wip?sort=under&dir=asc" : null, "Underbilled", `${under.count} · ${formatWhole(Math.abs(under.cents))}`, true, true);
  push("mentions", mentions, mentions > 0 ? "/inbox" : null, "Mentions", String(mentions));
  push("leads", webLeadCount, webLeadCount > 0 ? webLeadHref : null, "New web leads", String(webLeadCount));
  push("warranty", warranty.count, warranty.href, "Warranty requests", String(warranty.count));
  push("vendor-bills", vendorBills.count, vendorBills.href, "Vendor bills", String(vendorBills.count));
  push("certs", vendorCerts.count, vendorCerts.href, "Vendor certificates", String(vendorCerts.count));
  push("bids-due", bids.due.count, bids.due.href, "Bids due", String(bids.due.count));
  push("bids-award", bids.award.count, bids.award.href, "Bids to award", String(bids.award.count));
  push("bill", ready.count, ready.href, "Ready to bill", `${ready.count} · ${formatWhole(ready.cents)}`, true);
  push("pay", payReady.count, payReady.href, "Ready to pay", `${payReady.count} · ${formatWhole(payReady.cents)}`, true);
  push("retainage", heldRetainage.cents > 0 ? 1 : 0, heldRetainage.cents > 0 ? "/bills" : null, "Retainage held", formatWhole(heldRetainage.cents), true);
  push("rfi-over", rfis.overdue.count, rfis.overdue.href, "RFIs overdue", String(rfis.overdue.count));
  push("rfi-wait", rfis.awaiting.count, rfis.awaiting.href, "RFIs awaiting your answer", String(rfis.awaiting.count));
  push("sub-over", submittals.overdue.count, submittals.overdue.href, "Submittals overdue", String(submittals.overdue.count));
  push("sub-wait", submittals.awaiting.count, submittals.awaiting.href, "Submittals awaiting your review", String(submittals.awaiting.count));
  push("waivers", waivers.count, waivers.href, "Lien waivers", String(waivers.count));
  const lowCash = canEditCrm(session.role) ? cashAlert(session) : null;
  if (lowCash) attention.push({ key: "cash-low", href: lowCash.href, title: `Cash ${lowCash.label}`, count: 1, trailing: formatWhole(lowCash.cents), money: true, danger: true });
  const weekJobs = projects.filter((row) => row.project.status === "active").slice(0, 4);
  const fresh = board.cards.filter((card) => card.stage.kind === "open" && card.stage.name !== "Estimate sent" && card.stage.name !== "Negotiation").slice(0, 3);
  return (
    <>
    <div className="mx-auto flex max-w-lg flex-col gap-7 md:hidden">
      <LargeTitle title="Today" subtitle={longDate(time.timeZone)} action={<PlusLink href="/leads/new" label="Add a lead" />} />
      <KpiRow dashboard={home ? <DashboardStrip name={home.name} tiles={home.tiles} /> : null} kpis={kpis} />
      {showSetup ? <SetupRow steps={checklist.steps} /> : null}
      {proposal ? <FirstProposal steps={proposal} /> : null}
      {quiet ? <EmptyState title="No jobs yet" why="Add a lead to start your pipeline." href="/leads/new" action="Add a lead" /> : null}
      <Attention rows={attention} />
      {shown.length > 0 ? (
        <GroupedList label="Needs you">
          {shown.map((row) => (
            <GroupedRow
              key={row.key}
              href={row.href}
              title={row.title}
              subtitle={row.subtitle}
              trailing={<span className={row.late ? "fl-late" : undefined}>{row.trailing}</span>}
            />
          ))}
        </GroupedList>
      ) : null}
      {crew.length > 0 ? (
        <GroupedList label="On site">
          {crew.map((person) => (
            <li key={person.entryId}>
              <Link href="/time" className="fl-cell fl-press">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--fl-fill)] fl-footnote">
                  {initials(person.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="fl-body block truncate">{person.name}</span>
                  <span className="fl-secondary-text block truncate text-[var(--fl-secondary)]">
                    {person.projectName.split(" ")[0]} · {person.costCode}
                  </span>
                </span>
                <span className="fl-body tabular-nums text-[var(--fl-secondary)]">{elapsed(person.since).text}</span>
              </Link>
            </li>
          ))}
        </GroupedList>
      ) : null}
      {data.tasks.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="fl-section">Tasks</h2>
          <ul className="fl-group">
            {data.tasks.map((task) => {
              const word = dueWord(task.dueAt, time.timeZone);
              const late = word === "Yesterday" || word === "Late";
              return (
                <li key={task.id} className="fl-cell">
                  <form action={completeTaskAction.bind(null, task.id)}>
                    <button type="submit" aria-label="Done" className="fl-press inline-flex size-11 items-center justify-center">
                      <span className="size-[22px] rounded-full border border-[var(--fl-tertiary)]" />
                    </button>
                  </form>
                  <span className="fl-body min-w-0 flex-1 truncate">{task.title}</span>
                  <span className={`fl-body tabular-nums ${late ? "fl-late" : "text-[var(--fl-secondary)]"}`}>{word}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
    <div className="hidden md:flex md:flex-col">
      <Toolbar title="Today" subtitle={longDate(time.timeZone)} primaryHref="/leads/new" />
      <div className="flex flex-col gap-5 px-6 pb-8">
        <KpiRow dashboard={home ? <DashboardStrip name={home.name} tiles={home.tiles} /> : null} kpis={kpis} />
        {showSetup ? <SetupRow steps={checklist.steps} /> : null}
        {proposal ? <FirstProposal steps={proposal} /> : null}
        {quiet ? <EmptyState title="No jobs yet" why="Add a lead to start your pipeline." href="/leads/new" action="Add a lead" /> : null}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex flex-col gap-6">
            <Attention rows={attention} />
            {shown.length > 0 ? (
              <GroupedList label="Needs you">
                {shown.map((row) => (
                  <GroupedRow key={row.key} href={row.href} title={row.title} subtitle={row.subtitle} trailing={<span className={row.late ? "text-[var(--mac-danger)]" : undefined}>{row.trailing}</span>} />
                ))}
              </GroupedList>
            ) : null}
            {weekJobs.length > 0 ? (
              <GroupedList label="This week">
                {weekJobs.map((row) => (
                  <GroupedRow
                    key={row.project.id}
                    href={`/projects/${row.project.id}`}
                    title={row.project.name}
                    subtitle={milestone(row.project.id)}
                    trailing={
                      money ? (
                        <span className="inline-flex items-center gap-3">
                          <span className={`w-10 text-right ${row.alert ? "text-[var(--mac-danger)]" : ""}`}>{formatPercent(row.marginBps)}</span>
                          <span className="w-16 text-right">{formatWhole(row.project.contractValueCents)}</span>
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </GroupedList>
            ) : null}
            {fresh.length > 0 ? (
              <GroupedList label="New leads">
                {fresh.map((card) => (
                  <GroupedRow
                    key={card.lead.id}
                    href={`/leads/${card.lead.id}`}
                    title={card.lead.title}
                    subtitle={`${card.contact.name} · ${card.lead.source}`}
                    trailing={money && card.lead.valueEstCents ? formatWhole(card.lead.valueEstCents) : undefined}
                  />
                ))}
              </GroupedList>
            ) : null}
          </div>
          <div className="flex flex-col gap-6">
            {crew.length > 0 ? (
              <GroupedList label="On site">
                {crew.map((person) => {
                  const punch = elapsed(person.since);
                  return (
                    <GroupedRow
                      key={person.entryId}
                      href="/time"
                      title={person.name}
                      subtitle={`${person.projectName} · ${person.costCode}`}
                      trailing={<span className={punch.forgotten ? "font-semibold text-[var(--mac-warning)]" : undefined}>{punch.text}</span>}
                    />
                  );
                })}
              </GroupedList>
            ) : null}
            {data.tasks.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="fl-section">Tasks</h2>
                <ul className="fl-group">
                  {data.tasks.map((task) => {
                    const word = dueWord(task.dueAt, time.timeZone);
                    const late = word === "Yesterday" || word === "Late";
                    return (
                      <li key={task.id} className="fl-cell" data-mac-row={task.title}>
                        <form action={completeTaskAction.bind(null, task.id)}>
                          <button type="submit" aria-label="Done" className="fl-press inline-flex size-5 items-center justify-center">
                            <span className="size-3.5 rounded-full border border-[var(--mac-separator)]" />
                          </button>
                        </form>
                        <span className="fl-body min-w-0 flex-1 truncate">{task.title}</span>
                        <span className={`fl-body num ${late ? "text-[var(--mac-danger)]" : "text-[var(--mac-secondary)]"}`}>{word}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {money && cash.length > 0 ? (
              <GroupedList label="Cash next 14 days">
                {cash.map(({ invoice, project }) => (
                  <GroupedRow
                    key={invoice.id}
                    href={`/pay/${invoice.payToken}`}
                    title={project.name}
                    subtitle={invoice.dueDate.slice(0, 10) < todayKey ? "Late" : formatCalendarDay(invoice.dueDate)}
                    trailing={formatWhole(invoice.totalCents - invoice.amountPaidCents)}
                  />
                ))}
              </GroupedList>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
