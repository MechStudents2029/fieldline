import Link from "next/link";
import { notFound } from "next/navigation";
import { startHandoverAction } from "@/app/(office)/handover/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { handoverForProject } from "@/lib/services/handover";
import { getDb } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { projects } from "@/lib/db/schema";

export default async function JobHandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const project = getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.orgId, session.orgId)))
    .get();
  if (!project) notFound();
  const pack = handoverForProject(session, id);
  const office = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={project.name}
          subtitle={pack ? String(pack.readiness) : "0"}
          search={false}
          leading={<Link href={`/projects/${id}`}>‹</Link>}
          center={jobSectionTabs(id, "handover")}
        />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Handover</h1>
        {pack ? (
          <p>
            <Link href={`/handover/${pack.id}`} className="text-[var(--mac-accent)]">
              {pack.statusLabel}
            </Link>
            <span className="num ml-2" data-readiness={pack.readiness}>
              {pack.readiness}
            </span>
          </p>
        ) : null}
        {office && !pack ? (
          <ActionForm action={startHandoverAction}>
            <input type="hidden" name="projectId" value={id} />
            <Button type="submit">Start package</Button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
