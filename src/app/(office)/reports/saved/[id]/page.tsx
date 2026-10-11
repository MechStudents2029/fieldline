import { notFound } from "next/navigation";
import { archiveReportAction, duplicateReportAction, renameReportAction } from "@/app/(office)/reports/actions";
import { ReportScreen } from "@/components/report-screen";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { openSaved } from "@/lib/services/reports";

export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let view: ReturnType<typeof openSaved>;
  try {
    view = openSaved(session, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  return (
    <ReportScreen
      view={view}
      csvHref={`/api/export/report?id=${id}&saved=1`}
      actions={
        view.owner ? (
          <span className="flex items-center gap-2">
            <form action={renameReportAction} className="flex items-center gap-1">
              <input type="hidden" name="id" value={id} />
              <input name="name" aria-label="Name" defaultValue={view.name} className="field h-7 w-40" />
              <select name="share" aria-label="Share" defaultValue={view.share} className="ctl">
                <option value="private">Private</option>
                <option value="office">Office</option>
                <option value="everyone">Everyone</option>
              </select>
              <button type="submit" className="ctl">
                Save
              </button>
            </form>
            <form action={duplicateReportAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="ctl">
                Duplicate
              </button>
            </form>
            <form action={archiveReportAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="ctl">
                Archive
              </button>
            </form>
          </span>
        ) : null
      }
    />
  );
}
