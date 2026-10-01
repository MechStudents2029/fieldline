import Link from "next/link";
import { completeTaskAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { formatBps, formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { dashboard, leadDetail } from "@/lib/services/read";

export default async function TodayPage() {
  const session = await requireSession();
  const data = dashboard(session.orgId);
  const money = canSeeMoney(session.role);
  const vasquez = leadDetail(session.orgId, "lead_vasquez");
  const vasquezOpen = vasquez && !vasquez.proposals.some((proposal) => proposal.status === "signed");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl">Today</h1>
        <p className="text-sm text-muted-foreground">Open work for {session.orgName}.</p>
      </div>
      {vasquezOpen ? (
        <Link href="/leads/lead_vasquez" className="rounded-2xl bg-primary px-5 py-4 text-primary-foreground">
          <p className="text-xs uppercase tracking-wide opacity-80">Continue the walkthrough</p>
          <p className="font-heading text-2xl">Vasquez gut kitchen</p>
          <p className="mt-1 text-sm opacity-90">Paste is already on the lead. Draft the estimate, send it, and sign it from the client link.</p>
        </Link>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open pipeline" value={money ? formatMoney(data.pipelineCents) : "Hidden"} detail={`${data.openLeadCount} deals`} />
        <Stat label="Receivables" value={money ? formatMoney(data.receivableCents) : "Hidden"} detail={`${data.openInvoiceCount} open invoices`} />
        <Stat label="Margin watch" value={money ? String(data.marginAlerts.length) : "Hidden"} detail="Jobs under the alert line" />
        <Stat label="Unsigned 3+ days" value={String(data.unsigned.length)} detail={`${data.drafts.length} drafts waiting`} />
      </div>
      {money && data.marginAlerts.length > 0 ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-heading text-xl">Margin watch</h2>
          <ul className="mt-3 divide-y divide-border">
            {data.marginAlerts.map((row) => (
              <li key={row.project.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/projects/${row.project.id}`} className="font-medium">
                  {row.project.name}
                </Link>
                <span className="text-copper">{formatBps(row.marginBps)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-heading text-xl">Tasks</h2>
        {data.tasks.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No open tasks.</p> : null}
        <ul className="mt-2 space-y-2">
          {data.tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {task.title}
                <span className="block text-xs text-muted-foreground">Due {formatDate(task.dueAt)}</span>
              </span>
              <form action={completeTaskAction.bind(null, task.id)}>
                <Button type="submit" variant="outline" size="sm">
                  Done
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-heading mt-1 text-2xl">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
