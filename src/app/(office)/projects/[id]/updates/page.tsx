import Link from "next/link";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { DataTable } from "@/components/mac/data-table";
import { Toolbar } from "@/components/mac/toolbar";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { canEditCrm } from "@/lib/permissions";
import { listClientUpdates } from "@/lib/services/client-updates";
import { ServiceError } from "@/lib/services/errors";
import { calendarForOrg } from "@/lib/services/time";

export const dynamic = "force-dynamic";

function statusLabel(status: string) {
  if (status === "published") return "Published";
  if (status === "unpublished") return "Unpublished";
  return "Draft";
}

export default async function ClientUpdatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let board: ReturnType<typeof listClientUpdates>;
  try {
    board = listClientUpdates(session, id);
  } catch (error) {
    if (error instanceof ServiceError) return <MissingRecord orgName={session.orgName} kind="job" />;
    throw error;
  }
  const zone = calendarForOrg(session.orgId).timeZone;
  const office = canEditCrm(session.role);
  const range = (start: string, end: string) => `${formatCalendarDay(start)} – ${formatCalendarDay(end)}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Client updates"
        subtitle={board.project.name}
        search={false}
        leading={<Link href={`/projects/${id}`}>‹</Link>}
        center={jobSectionTabs(id, "updates")}
        trailing={office ? <Link href={`/projects/${id}/updates/new`} className="mac-primary">New</Link> : null}
      />
      {board.rows.length === 0 ? (
        <p className="px-4 py-6 mac-t13 text-[var(--mac-secondary)]">No client updates</p>
      ) : (
        <DataTable
          columns={[
            { key: "range", header: "Range" },
            { key: "status", header: "Status" },
            { key: "published", header: "Published", fit: true },
            { key: "viewed", header: "Viewed", fit: true },
          ]}
          rows={board.rows.map((row) => ({
            id: row.id,
            href: office ? `/projects/${id}/updates/${row.id}` : undefined,
            cells: {
              range: { text: range(row.rangeStart, row.rangeEnd), sort: row.rangeEnd },
              status: { text: statusLabel(row.status), tone: "pill" as const, sort: row.status },
              published: { text: formatDateTime(row.publishedAt, zone), sort: row.publishedAt ?? "" },
              viewed: { text: formatDateTime(row.viewedAt, zone), sort: row.viewedAt ?? "" },
            },
          }))}
        />
      )}
    </div>
  );
}
