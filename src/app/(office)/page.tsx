import Link from "next/link";
import { completeTaskAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle, StatusPill } from "@/components/ios";
import { SetupChecklist } from "@/components/setup-checklist";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { formatBps, formatMoney } from "@/lib/money";
import { canManageMoney, canManageSettings, canSeeMoney } from "@/lib/permissions";
import { companyChecklist } from "@/lib/services/onboarding";
import { dashboard, leadDetail, listProjects, pendingReceipts } from "@/lib/services/read";
import { MyDay } from "@/components/my-day";
import { missingDailyLogs } from "@/lib/services/logs";
import { billsAttention } from "@/lib/services/bills";
import { stalePurchaseOrders } from "@/lib/services/purchase-orders";
import { listTimeAnomalies } from "@/lib/services/sync";
import { timeBoard } from "@/lib/services/time";

function todayLabel(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date());
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default async function TodayPage() {
  const session = await requireSession();
  if (session.role === "field") return <MyDay actor={session} />;
  const data = dashboard(session.orgId);
  const money = canSeeMoney(session.role);
  const vasquez = leadDetail(session.orgId, "lead_vasquez");
  const vasquezOpen = vasquez && !vasquez.proposals.some((proposal) => proposal.status === "signed");
  const receipts = money ? pendingReceipts(session.orgId) : [];
  const checklist = companyChecklist(session.orgId);
  const time = timeBoard(session);
  const missingLogs = money ? missingDailyLogs(session.orgId) : [];
  const anomalies = canManageMoney(session.role) ? listTimeAnomalies(session.orgId) : [];
  const billWatch = money ? billsAttention(session.orgId, session.role) : { overdue: [], upcoming: [] };
  const staleOrders = money ? stalePurchaseOrders(session.orgId, session.role) : [];
  const projects = listProjects(session.orgId);
  const jobs = projects
    .filter((row) => row.project.status !== "complete" && row.project.status !== "cancelled")
    .sort((a, b) => Number(a.alert) - Number(b.alert) || a.project.name.localeCompare(b.project.name));
  const healthy = projects
    .filter((row) => row.marginBps != null && !row.alert)
    .sort((a, b) => {
      const prefer = (name: string) => (name.includes("Okonkwo") ? 1 : 0);
      return prefer(b.project.name) - prefer(a.project.name) || (b.marginBps ?? 0) - (a.marginBps ?? 0);
    })[0];
  const attentionBits = [
    data.drafts.length > 0 ? countLabel(data.drafts.length, "follow-up", "follow-ups") : null,
    billWatch.overdue.length > 0 ? countLabel(billWatch.overdue.length, "overdue bill", "overdue bills") : null,
  ].filter(Boolean);
  const quiet =
    data.openLeadCount === 0 &&
    data.openInvoiceCount === 0 &&
    data.tasks.length === 0 &&
    data.drafts.length === 0 &&
    data.marginAlerts.length === 0 &&
    data.unsigned.length === 0;
  const crew = time.office?.clockedIn ?? [];
  return (
    <div className="flex flex-col gap-6">
      <LargeTitle title="Today" subtitle={`${todayLabel(time.timeZone)} · ${session.orgName}`} />
      {checklist && !checklist.facts.dismissed ? (
        <SetupChecklist steps={checklist.steps} canDismiss={canManageSettings(session.role)} />
      ) : null}
      {quiet ? (
        <EmptyState
          title="Nothing on the board yet"
          why="Today lists open deals, invoices waiting on payment, and tasks for this company. A new company has none of those yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      {attentionBits.length > 0 || healthy ? (
        <section>
          <p className="fl-footnote text-[var(--fl-secondary)]">Needs attention</p>
          {attentionBits.length > 0 ? <p className="fl-headline mt-1">{attentionBits.join(" · ")}</p> : null}
          {healthy ? (
            <p className="fl-footnote mt-1 font-medium text-[var(--fl-success)]">
              {healthy.project.name.split(" ")[0]} margin healthy at {formatBps(healthy.marginBps)}
            </p>
          ) : null}
        </section>
      ) : null}
      {data.drafts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="fl-section">Follow-ups to approve</h2>
          <p className="fl-footnote px-5 text-[var(--fl-secondary)]">These stay drafts until someone approves them. Today does not send email.</p>
          <ul className="fl-group">
            {data.drafts.slice(0, 6).map((draft) => (
              <li key={draft.id}>
                <div className="fl-cell">
                  <span className="min-w-0 flex-1">
                    <span className="fl-headline block">{draft.subject}</span>
                    <span className="fl-footnote mt-0.5 block text-[var(--fl-secondary)]">
                      {draft.kind === "proposal_unsigned" ? "Proposal viewed · nudge ready" : "Quiet lead · not sent"}
                    </span>
                  </span>
                  <Link href="/follow-ups" className="fl-press fl-caption inline-flex min-h-11 items-center text-[var(--fl-accent)]">
                    Review
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {jobs.length > 0 ? (
        <GroupedList label="Jobs">
          {jobs.map((row) => (
            <GroupedRow
              key={row.project.id}
              href={`/projects/${row.project.id}`}
              title={row.project.name}
              subtitle={
                row.alert
                  ? "Under the margin line"
                  : money
                    ? `${formatMoney(row.project.contractValueCents)} · ${row.project.status}`
                    : row.project.status
              }
              trailing={
                money ? (
                  <StatusPill tone={row.alert ? "danger" : "success"}>{row.alert ? "Alert" : formatBps(row.marginBps)}</StatusPill>
                ) : (
                  <span className="fl-footnote text-[var(--fl-secondary)]">Money hidden</span>
                )
              }
            />
          ))}
        </GroupedList>
      ) : null}
      {crew.length > 0 ? (
        <GroupedList label="Crew on site">
          {crew.map((person) => (
            <GroupedRow
              key={person.entryId}
              href="/time"
              title={person.name}
              subtitle={`${person.projectName} · ${person.costCode}`}
              trailing={<StatusPill tone={person.onBreak ? "warning" : "accent"}>{person.onBreak ? "Break" : "In"}</StatusPill>}
            />
          ))}
        </GroupedList>
      ) : null}
      {vasquezOpen ? (
        <Link href="/leads/lead_vasquez" className="fl-press rounded-[var(--fl-radius)] bg-primary px-5 py-4 text-primary-foreground">
          <p className="fl-caption uppercase tracking-wide opacity-80">Continue the walkthrough</p>
          <p className="fl-title-1">Vasquez gut kitchen</p>
          <p className="fl-footnote mt-1 opacity-90">Paste is already on the lead. Draft the estimate, send it, and sign it from the client link.</p>
        </Link>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open pipeline" value={money ? formatMoney(data.pipelineCents) : "Hidden"} detail={`${data.openLeadCount} deals`} />
        <Stat label="Receivables" value={money ? formatMoney(data.receivableCents) : "Hidden"} detail={`${data.openInvoiceCount} open invoices`} />
        <Stat
          label="Margin watch"
          value={money ? String(data.marginAlerts.length) : "Hidden"}
          detail={money ? `${data.categoryAlerts.length} cost codes at 80%` : "Jobs under the alert line"}
        />
        <Stat label="Follow-ups due" value={String(data.unsigned.length)} detail={`${data.drafts.length} to approve`} />
      </div>
      {money && (data.marginAlerts.length > 0 || data.categoryAlerts.length > 0) ? (
        <GroupedList label="Margin watch">
          {data.marginAlerts.map((row) => (
            <GroupedRow
              key={row.project.id}
              href={`/projects/${row.project.id}`}
              title={row.project.name}
              subtitle="Whole-job margin under the alert line"
              trailing={<StatusPill tone="danger">{formatBps(row.marginBps)}</StatusPill>}
            />
          ))}
          {data.categoryAlerts.map((row) => (
            <GroupedRow
              key={`${row.projectId}-${row.code}`}
              href={`/projects/${row.projectId}`}
              title={row.projectName}
              subtitle={`${row.code} · ${row.percentOfBudget}% of budget${row.overageCents > 0 ? ` · ${formatMoney(row.overageCents)} over` : ""}`}
              trailing={<StatusPill tone="warning">{row.percentOfBudget}%</StatusPill>}
            />
          ))}
        </GroupedList>
      ) : null}
      {missingLogs.length > 0 ? (
        <GroupedList label="Logs to write">
          {missingLogs.map((row) => (
            <GroupedRow
              key={row.projectId}
              href={`/projects/${row.projectId}/logs`}
              title={`${row.projectName} · ${row.logDate}`}
              subtitle="Punches yesterday and no published log. Nothing is sent."
            />
          ))}
        </GroupedList>
      ) : null}
      {anomalies.length > 0 ? (
        <GroupedList label="Time anomalies">
          {anomalies.map((row) => (
            <GroupedRow key={row.id} href="/time" title={row.detail} subtitle="Synced from a phone. Nothing was discarded." />
          ))}
        </GroupedList>
      ) : null}
      {time.flags.length > 0 ? (
        <GroupedList label="Time to check">
          {time.flags.map((flag) => (
            <GroupedRow
              key={`${flag.kind}-${flag.entryIds.join("-")}`}
              href="/time"
              title={flag.detail}
              subtitle="Stays until the office edits or approves the punch."
            />
          ))}
        </GroupedList>
      ) : null}
      {billWatch.overdue.length > 0 || billWatch.upcoming.length > 0 ? (
        <GroupedList label="Bills">
          {billWatch.overdue.map((bill) => (
            <GroupedRow
              key={bill.id}
              href={`/bills/${bill.id}`}
              title={`Overdue · ${bill.billNumber} · ${bill.vendorName}`}
              subtitle={`${formatMoney(bill.amountCents)} · ${bill.projectName}`}
              trailing={<StatusPill tone="danger">Overdue</StatusPill>}
            />
          ))}
          {billWatch.upcoming.map((bill) => (
            <GroupedRow
              key={bill.id}
              href={`/bills/${bill.id}`}
              title={`Due soon · ${bill.billNumber} · ${bill.vendorName}`}
              subtitle={`${formatMoney(bill.amountCents)} · ${bill.projectName}`}
              trailing={<StatusPill tone="warning">Due soon</StatusPill>}
            />
          ))}
        </GroupedList>
      ) : null}
      {staleOrders.length > 0 ? (
        <GroupedList label="Purchase orders waiting on a bill">
          {staleOrders.map((order) => (
            <GroupedRow
              key={order.id}
              href={`/purchase-orders/${order.id}`}
              title={`${order.number} · ${order.vendorName}`}
              subtitle={`${formatMoney(order.openCents)} open · ${order.projectName}`}
            />
          ))}
        </GroupedList>
      ) : null}
      {receipts.length > 0 ? (
        <GroupedList label="Receipts to review">
          {receipts.map((receipt) => (
            <GroupedRow
              key={receipt.documentId}
              href={`/projects/${receipt.projectId}`}
              title={`${receipt.vendor ?? "Receipt"} · ${receipt.projectName}`}
              subtitle={`${receipt.amountCents == null ? "Amount missing" : formatMoney(receipt.amountCents)}${receipt.confidence != null ? ` · ${Math.round(receipt.confidence * 100)}%` : ""}`}
            />
          ))}
        </GroupedList>
      ) : null}
      <section className="flex flex-col gap-2">
        <h2 className="fl-section">Tasks</h2>
        {data.tasks.length === 0 ? <p className="fl-footnote px-5 text-[var(--fl-secondary)]">No open tasks.</p> : null}
        {data.tasks.length > 0 ? (
          <ul className="fl-group">
            {data.tasks.map((task) => (
              <li key={task.id} className="fl-cell">
                <span className="min-w-0 flex-1">
                  <span className="fl-headline block">{task.title}</span>
                  <span className="fl-footnote mt-0.5 block text-[var(--fl-secondary)]">Due {formatDate(task.dueAt)}</span>
                </span>
                <form action={completeTaskAction.bind(null, task.id)}>
                  <Button type="submit" variant="outline" size="sm" className="min-h-11 min-w-11">
                    Done
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[var(--fl-radius)] bg-card p-4">
      <p className="fl-caption uppercase tracking-wide text-[var(--fl-secondary)]">{label}</p>
      <p className="fl-title-1 mt-1">{value}</p>
      <p className="fl-footnote text-[var(--fl-secondary)]">{detail}</p>
    </div>
  );
}
