import { startLogAction } from "@/app/actions";
import { JobTabs } from "@/components/job-tabs";
import { MissingRecord } from "@/components/missing-record";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { canAddFieldNotes } from "@/lib/permissions";
import { jobLogs } from "@/lib/services/logs";

export default async function JobLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const board = jobLogs(session, id);
  if (!board) return <MissingRecord orgName={session.orgName} kind="job" />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">Logs</h1>
        <p className="text-sm text-muted-foreground">
          {board.project.name}. One log per person per day in {board.timeZone}.
        </p>
        <div className="mt-3">
          <JobTabs projectId={id} current="logs" />
        </div>
      </div>
      {canAddFieldNotes(session.role) ? (
        <form action={startLogAction.bind(null, id)} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-end">
          <label className="text-sm">
            Date
            <input type="date" name="logDate" max={board.today} defaultValue={board.today} required className="field mt-1" />
          </label>
          <Button type="submit" className="h-12">
            Open log
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Viewers cannot write a daily log.</p>
      )}
      <ul className="space-y-2">
        {board.logs.length === 0 ? <li className="text-sm text-muted-foreground">No logs yet.</li> : null}
        {board.logs.map(({ log, author }) => (
          <li key={log.id}>
            <a href={`/projects/${id}/logs/${log.id}`} className="block rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
              <span className="font-medium">
                {formatCalendarDay(log.logDate)} · {author}
              </span>
              <span className="block text-xs text-muted-foreground">
                {log.status} · {log.visibility === "client" ? "on the client portal" : "internal"}
              </span>
              {log.notes ? <span className="mt-1 block">{log.notes}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
