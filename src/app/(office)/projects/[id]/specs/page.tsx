import Link from "next/link";
import { notFound } from "next/navigation";
import { createSpecFromBudgetAction } from "@/app/(office)/specs/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { specPacks } from "@/lib/services/job-specs";
import { and, eq } from "drizzle-orm";

export default async function ProjectSpecsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const project = getDb().select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, session.orgId))).get();
  if (!project) notFound();
  const rows = specPacks(session, { projectId: id });
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={project.name} subtitle={String(rows.length)} search={false} leading={<Link href={`/projects/${id}`}>‹</Link>} center={jobSectionTabs(id, "specs")} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="fl-large-title md:hidden">Specifications</h1>
          {canEditCrm(session.role) ? (
            <ActionForm action={createSpecFromBudgetAction.bind(null, id)}>
              <button type="submit" className="text-[var(--mac-accent)]">
                From budget
              </button>
            </ActionForm>
          ) : null}
        </div>
        {rows.length === 0 ? <p className="text-sm text-[var(--mac-secondary)]">No specs.</p> : null}
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} data-spec={row.id} data-status={row.status}>
              <Link href={`/specs/${row.id}`} className="text-sm">
                {row.title}
              </Link>
              <span className="fl-pill ml-2">{row.status === "published" ? "Published" : "Draft"}</span>
              <span className="num ml-2">v{row.version}</span>
              {row.changed && session.role !== "field" ? <span className="fl-pill ml-2">Budget changed</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
