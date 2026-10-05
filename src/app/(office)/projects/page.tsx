import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { requireSession } from "@/lib/auth/session";
import { formatBps, formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listProjects } from "@/lib/services/read";

export default async function ProjectsPage() {
  const session = await requireSession();
  const rows = listProjects(session.orgId);
  const money = canSeeMoney(session.role);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-3xl">Jobs</h1>
      {rows.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          why="A job appears when a client signs a proposal. The page then shows the contract and the budget. This company has no signed work yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.project.id}>
            <Link href={`/projects/${row.project.id}`} className="block rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.project.name}</p>
                  <p className="text-xs text-muted-foreground">{row.project.address} · {row.project.status}</p>
                </div>
                {money ? (
                  <p className={row.alert ? "text-copper" : ""}>
                    {formatBps(row.marginBps)}
                    <span className="block text-right text-xs text-muted-foreground">{formatMoney(row.project.contractValueCents)}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Money hidden</p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
