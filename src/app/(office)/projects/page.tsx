import { EmptyState } from "@/components/empty-state";
import { GroupedList, GroupedRow, LargeTitle, StatusPill } from "@/components/ios";
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
      <LargeTitle title="Jobs" subtitle={rows.length === 0 ? session.orgName : `${rows.length} ${rows.length === 1 ? "job" : "jobs"} · ${session.orgName}`} />
      {rows.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          why="A job appears when a client signs a proposal. The page then shows the contract and the budget. This company has no signed work yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : (
        <GroupedList label="All jobs">
          {rows.map((row) => (
            <GroupedRow
              key={row.project.id}
              href={`/projects/${row.project.id}`}
              title={row.project.name}
              subtitle={
                money
                  ? `${row.project.address} · ${formatMoney(row.project.contractValueCents)} · ${row.project.status}`
                  : `${row.project.address} · ${row.project.status}`
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
      )}
    </div>
  );
}
