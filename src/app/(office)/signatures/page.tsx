import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { listProjects } from "@/lib/services/read";
import { signatureRequests } from "@/lib/services/doc-signatures";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignaturesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const status = one(query.status) ?? "";
  const projectId = one(query.project) ?? "";
  const signerRole = one(query.signer) ?? "";
  const overdue = one(query.overdue) === "1";
  const rows = signatureRequests(session, { status, projectId, signerRole, overdue });
  const jobs = listProjects(session.orgId).map((row) => ({ id: row.project.id, name: row.project.name }));
  const csv = `/api/export/signatures?status=${encodeURIComponent(status)}&project=${encodeURIComponent(projectId)}&signer=${encodeURIComponent(signerRole)}&overdue=${overdue ? "1" : ""}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Signatures" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="fl-large-title md:hidden">Signatures</h1>
          {canEditCrm(session.role) ? (
            <Link href="/signatures/new" className="text-[var(--mac-accent)]">
              Request
            </Link>
          ) : null}
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="status" aria-label="Status" defaultValue={status} className="field w-auto">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="out">Out for signature</option>
            <option value="signed">Signed</option>
            <option value="declined">Declined</option>
            <option value="voided">Voided</option>
          </select>
          <select name="project" aria-label="Job" defaultValue={projectId} className="field w-auto">
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <select name="signer" aria-label="Signer type" defaultValue={signerRole} className="field w-auto">
            <option value="">All signers</option>
            <option value="client">Client</option>
            <option value="vendor">Vendor</option>
            <option value="team">Team</option>
          </select>
          <select name="overdue" aria-label="Overdue" defaultValue={overdue ? "1" : ""} className="field w-auto">
            <option value="">All</option>
            <option value="1">Overdue</option>
          </select>
          <button type="submit" className="ctl h-9">
            Show
          </button>
          <Link href={csv} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        {rows.length === 0 ? <p className="text-sm text-[var(--mac-secondary)]">No requests.</p> : null}
        <table aria-label="Signatures" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-1 font-medium">Document</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-request={row.id} data-status={row.status}>
                <td className="py-1">
                  <Link href={`/signatures/${row.id}`}>{row.title}</Link>
                  {row.projectName ? <span className="ml-2 text-[var(--mac-secondary)]">{row.projectName}</span> : null}
                </td>
                <td className="py-1">
                  <span className="fl-pill">{row.statusLabel}</span>
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
