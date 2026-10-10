import Link from "next/link";
import { saveClientUpdateAction, unpublishClientUpdateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { clientUpdateDetail } from "@/lib/services/client-updates";
import { ServiceError } from "@/lib/services/errors";
import { calendarForOrg } from "@/lib/services/time";

export const dynamic = "force-dynamic";

function statusLabel(status: string) {
  if (status === "published") return "Published";
  if (status === "unpublished") return "Unpublished";
  return "Draft";
}

export default async function ClientUpdateEditorPage({ params }: { params: Promise<{ id: string; updateId: string }> }) {
  const { id, updateId } = await params;
  const session = await requireSession();
  let detail: ReturnType<typeof clientUpdateDetail>;
  try {
    detail = clientUpdateDetail(session, id, updateId);
  } catch (error) {
    if (error instanceof ServiceError) return <MissingRecord orgName={session.orgName} kind="job" />;
    throw error;
  }
  if (!detail) return <MissingRecord orgName={session.orgName} kind="job" />;
  const zone = calendarForOrg(session.orgId).timeZone;
  let storedPhotos: string[] = [];
  try {
    const parsed = JSON.parse(detail.update.photoIdsJson) as unknown;
    storedPhotos = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    storedPhotos = [];
  }
  const selected = new Set(storedPhotos);
  const range = `${formatCalendarDay(detail.update.rangeStart)} – ${formatCalendarDay(detail.update.rangeEnd)}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Client update"
        subtitle={range}
        search={false}
        leading={<Link href={`/projects/${id}/updates`}>‹</Link>}
        center={jobSectionTabs(id, "updates")}
        trailing={
          <>
            <span className="fl-pill fl-pill-sm" data-status={detail.update.status}>
              {statusLabel(detail.update.status)}
            </span>
            <button className="ctl" type="submit" form="update-form" name="intent" value="save">
              Save
            </button>
            {detail.update.status === "published" ? null : (
              <button className="mac-primary" type="submit" form="update-form" name="intent" value="publish">
                Publish
              </button>
            )}
          </>
        }
      />
      <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <ActionForm id="update-form" action={saveClientUpdateAction.bind(null, id, updateId)} className="flex flex-col gap-3">
          <textarea className="update-body" name="body" aria-label="Update" defaultValue={detail.update.body} />
        </ActionForm>
        <aside className="flex flex-col gap-4" aria-label="Update details">
          <section className="flex flex-col gap-2">
            <h2 className="mac-t11 font-semibold text-[var(--mac-secondary)]">Photos</h2>
            {detail.photos.length === 0 ? <p className="mac-t11 text-[var(--mac-secondary)]">None</p> : null}
            {detail.photos.map((photo) => (
              <label key={photo.id} className="flex items-center gap-2 mac-t13">
                <input type="checkbox" name="photoId" value={photo.id} form="update-form" defaultChecked={selected.has(photo.id)} aria-label={photo.caption || "Photo"} />
                <span className="truncate">{photo.caption || "Photo"}</span>
              </label>
            ))}
          </section>
          <section className="flex flex-col gap-1">
            <h2 className="mac-t11 font-semibold text-[var(--mac-secondary)]">Sources</h2>
            {detail.sources?.sections.flatMap((part) =>
              part.sentences
                .filter((row) => row.source)
                .map((row) => (
                  <p key={`${part.key}-${row.source?.id}-${row.text}`} className="truncate mac-t11 text-[var(--mac-secondary)]" title={row.text}>
                    {part.title} · {row.source?.kind} {row.source?.id}
                  </p>
                )),
            )}
          </section>
          <section className="flex flex-col gap-1">
            <h2 className="mac-t11 font-semibold text-[var(--mac-secondary)]">Versions</h2>
            {detail.versions.length === 0 ? <p className="mac-t11 text-[var(--mac-secondary)]">None</p> : null}
            {detail.versions.map((version) => (
              <p key={version.id} className="mac-t11 text-[var(--mac-secondary)]">
                v{version.version} · {formatDateTime(version.createdAt, zone)}
              </p>
            ))}
          </section>
          {detail.update.status === "published" ? (
            <ActionForm action={unpublishClientUpdateAction.bind(null, id, updateId)} className="flex flex-col gap-2">
              <input className="field" name="reason" aria-label="Unpublish reason" />
              <button className="ctl" type="submit">
                Unpublish
              </button>
            </ActionForm>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
