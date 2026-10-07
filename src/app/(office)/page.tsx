import Link from "next/link";
import { completeTaskAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle, NumberStrip, PlusLink } from "@/components/ios";
import { Toolbar } from "@/components/mac/toolbar";
import { FirstProposal, SetupRow } from "@/components/setup-checklist";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatCompact, formatPercent, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { companyChecklist, firstProposal } from "@/lib/services/onboarding";
import { dashboard, listInvoices, listProjects, pipelineBoard } from "@/lib/services/read";
import { MyDay } from "@/components/my-day";
import { WEBSITE_FORM_SOURCE } from "@/lib/lead-form/rules";
import { unseenWebLeadCount } from "@/lib/services/lead-form";
import { warrantyQueue } from "@/lib/services/punch";
import { vendorBillQueue, vendorCertificateQueue } from "@/lib/services/vendor-portal";
import { bidQueues } from "@/lib/services/bids";
import { overdueSelections } from "@/lib/services/selections";
import { timeBoard } from "@/lib/services/time";
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
  const todayKey = officeDay(time.timeZone);
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
  const weekJobs = projects.filter((row) => row.project.status === "active").slice(0, 4);
  const fresh = board.cards.filter((card) => card.stage.kind === "open" && card.stage.name !== "Estimate sent" && card.stage.name !== "Negotiation").slice(0, 3);
  return (
    <>
    <div className="mx-auto flex max-w-lg flex-col gap-7 md:hidden">
      <LargeTitle title="Today" subtitle={longDate(time.timeZone)} action={<PlusLink href="/leads/new" label="Add a lead" />} />
      {showSetup ? <SetupRow steps={checklist.steps} /> : null}
      {proposal ? <FirstProposal steps={proposal} /> : null}
      {money ? (
        <NumberStrip
          items={[
            { label: "Pipeline", value: formatCompact(data.pipelineCents) },
            { label: "To collect", value: formatCompact(data.receivableCents) },
            { label: "On site", value: String(crew.length) },
          ]}
        />
      ) : null}
      {quiet ? <EmptyState title="No jobs yet" why="Add a lead to start your pipeline." href="/leads/new" action="Add a lead" /> : null}
      {webLeadCount > 0 || warranty.count > 0 || vendorBills.count > 0 || vendorCerts.count > 0 || bids.due.count > 0 || bids.award.count > 0 ? (
        <ul className="fl-group">
          {webLeadCount > 0 ? <GroupedRow href={webLeadHref} title="New web leads" trailing={<span className="num">{webLeadCount}</span>} /> : null}
          {warranty.count > 0 && warranty.href ? <GroupedRow href={warranty.href} title="Warranty requests" trailing={<span className="num">{warranty.count}</span>} /> : null}
          {vendorBills.count > 0 && vendorBills.href ? <GroupedRow href={vendorBills.href} title="Vendor bills" trailing={<span className="num">{vendorBills.count}</span>} /> : null}
          {vendorCerts.count > 0 && vendorCerts.href ? <GroupedRow href={vendorCerts.href} title="Vendor certificates" trailing={<span className="num">{vendorCerts.count}</span>} /> : null}
          {bids.due.count > 0 && bids.due.href ? <GroupedRow href={bids.due.href} title="Bids due" trailing={<span className="num">{bids.due.count}</span>} /> : null}
          {bids.award.count > 0 && bids.award.href ? <GroupedRow href={bids.award.href} title="Bids to award" trailing={<span className="num">{bids.award.count}</span>} /> : null}
        </ul>
      ) : null}
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
        {showSetup ? <SetupRow steps={checklist.steps} /> : null}
        {proposal ? <FirstProposal steps={proposal} /> : null}
        {money ? (
          <div className="mac-strip">
            <div>
              <p className="mac-t22 num">{formatCompact(data.pipelineCents)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Pipeline</p>
            </div>
            <div>
              <p className="mac-t22 num">{formatCompact(data.receivableCents)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">To collect</p>
            </div>
            <div>
              <p className="mac-t22 num">{crew.length}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">On site</p>
            </div>
            <div>
              <p className="mac-t22 num">{formatPercent(avgMargin)}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">Avg margin</p>
            </div>
          </div>
        ) : null}
        {quiet ? <EmptyState title="No jobs yet" why="Add a lead to start your pipeline." href="/leads/new" action="Add a lead" /> : null}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex flex-col gap-6">
            {webLeadCount > 0 || warranty.count > 0 || vendorBills.count > 0 || vendorCerts.count > 0 || bids.due.count > 0 || bids.award.count > 0 ? (
              <ul className="fl-group">
                {webLeadCount > 0 ? <GroupedRow href={webLeadHref} title="New web leads" trailing={<span className="num">{webLeadCount}</span>} /> : null}
                {warranty.count > 0 && warranty.href ? <GroupedRow href={warranty.href} title="Warranty requests" trailing={<span className="num">{warranty.count}</span>} /> : null}
                {vendorBills.count > 0 && vendorBills.href ? <GroupedRow href={vendorBills.href} title="Vendor bills" trailing={<span className="num">{vendorBills.count}</span>} /> : null}
                {vendorCerts.count > 0 && vendorCerts.href ? <GroupedRow href={vendorCerts.href} title="Vendor certificates" trailing={<span className="num">{vendorCerts.count}</span>} /> : null}
                {bids.due.count > 0 && bids.due.href ? <GroupedRow href={bids.due.href} title="Bids due" trailing={<span className="num">{bids.due.count}</span>} /> : null}
                {bids.award.count > 0 && bids.award.href ? <GroupedRow href={bids.award.href} title="Bids to award" trailing={<span className="num">{bids.award.count}</span>} /> : null}
              </ul>
            ) : null}
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
