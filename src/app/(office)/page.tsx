import Link from "next/link";
import { completeTaskAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle, NumberStrip, PlusLink } from "@/components/ios";
import { SetupRow } from "@/components/setup-checklist";
import { requireSession } from "@/lib/auth/session";
import { formatCompact, formatPercent, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { companyChecklist } from "@/lib/services/onboarding";
import { dashboard, pipelineBoard } from "@/lib/services/read";
import { MyDay } from "@/components/my-day";
import { timeBoard } from "@/lib/services/time";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

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
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
  const shown = needs.slice(0, 5);
  const quiet = shown.length === 0 && data.tasks.length === 0 && crew.length === 0;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7">
      <LargeTitle title="Today" subtitle={longDate(time.timeZone)} action={<PlusLink href="/leads/new" label="Add a lead" />} />
      {showSetup ? <SetupRow steps={checklist.steps} /> : null}
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
                <span className="fl-body tabular-nums text-[var(--fl-secondary)]">{elapsed(person.since)}</span>
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
  );
}
