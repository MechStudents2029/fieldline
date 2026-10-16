import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/services/read";
import { specPacks } from "@/lib/services/job-specs";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SpecsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const status = one(query.status) ?? "";
  const projectId = one(query.project) ?? "";
  const flag = one(query.flag) === "1";
  const rows = specPacks(session, { status, projectId, flag });
  const jobs = listProjects(session.orgId).map((row) => ({ id: row.project.id, name: row.project.name }));
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Specifications" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Specifications</h1>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="status" aria-label="Status" defaultValue={status} className="field w-auto">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <select name="project" aria-label="Job" defaultValue={projectId} className="field w-auto">
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <select name="flag" aria-label="Flag" defaultValue={flag ? "1" : ""} className="field w-auto">
            <option value="">All</option>
            <option value="1">Budget changed</option>
          </select>
          <button type="submit" className="ctl h-9">
            Show
          </button>
          <Link href="/api/export/specs" className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        {rows.length === 0 ? <p className="text-sm text-[var(--mac-secondary)]">No specs.</p> : null}
        <table aria-label="Specifications" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-1 font-medium">Spec</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-spec={row.id} data-status={row.status} data-flag={row.changed ? "changed" : undefined}>
                <td className="py-1">
                  <Link href={`/specs/${row.id}`}>{row.title}</Link>
                  <span className="ml-2 text-[var(--mac-secondary)]">{row.projectName}</span>
                  <span className="num ml-2">v{row.version}</span>
                </td>
                <td className="py-1">
                  <span className="fl-pill">{row.status === "published" ? "Published" : "Draft"}</span>
                  {row.changed && session.role !== "field" ? <span className="fl-pill ml-2">Budget changed</span> : null}
                </td>
                <td className="num py-1">{row.dueOn || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
