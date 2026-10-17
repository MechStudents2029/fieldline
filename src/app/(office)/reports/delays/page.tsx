import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { canEditCrm } from "@/lib/permissions";
import { DELAY_REASONS } from "@/lib/schedule/delays";
import { DELAY_IMPACTS, DELAY_STATUSES, formatClaimHours, listDelays } from "@/lib/services/delays";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DelayReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canEditCrm(session.role)) notFound();
  const query = await searchParams;
  const cause = one(query.cause) ?? "";
  const impact = one(query.impact) ?? "";
  const status = one(query.status) ?? "";
  const projectId = one(query.project) ?? "";
  const rows = listDelays(session, { filter: status, cause, impact, projectId });
  const jobs = getDb().select().from(projects).where(eq(projects.orgId, session.orgId)).all().sort((a, b) => a.name.localeCompare(b.name));
  const params = new URLSearchParams();
  if (cause) params.set("cause", cause);
  if (impact) params.set("impact", impact);
  if (status) params.set("filter", status);
  if (projectId) params.set("project", projectId);
  const qs = params.toString();
  const csv = `/api/export/delays${qs ? `?${qs}` : ""}`;
  const print = `/reports/delays/print${qs ? `?${qs}` : ""}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Delays" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Delays</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="cause" aria-label="Cause" defaultValue={cause} className="field w-auto">
            <option value="">Cause</option>
            {DELAY_REASONS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
          <select name="impact" aria-label="Impact" defaultValue={impact} className="field w-auto">
            <option value="">Impact</option>
            {DELAY_IMPACTS.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
          <select name="status" aria-label="Status" defaultValue={status} className="field w-auto">
            <option value="">Status</option>
            {DELAY_STATUSES.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
          <select name="project" aria-label="Job" defaultValue={projectId} className="field w-auto">
            <option value="">Job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <button type="submit" className="mac-glass-btn">
            Show
          </button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
          <Link href={print} className="text-[var(--mac-accent)]">
            Print
          </Link>
        </form>
        <table aria-label="Delay report" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">Job</th>
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Cause</th>
              <th className="py-2 pr-3 font-medium">Impact</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">Lost h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--mac-separator)]">
                <td className="py-2 pr-3">{row.job}</td>
                <td className="py-2 pr-3 num">{row.number}</td>
                <td className="py-2 pr-3">
                  <Link href={`/delays/${row.id}`} className="text-[var(--mac-accent)]">
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{row.causeLabel}</td>
                <td className="py-2 pr-3">{row.impactLabel}</td>
                <td className="py-2 pr-3">{row.statusLabel}</td>
                <td className="py-2 text-right num">{formatClaimHours(row.lostHoursMilli)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
