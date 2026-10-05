import Link from "next/link";
import { logPhotoAction, saveLogAction, shareLogAction, voidLogAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { LogDraftSaver } from "@/components/log-draft-saver";
import { JobTabs } from "@/components/job-tabs";
import { MissingRecord } from "@/components/missing-record";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { captionFromMetadata } from "@/lib/services/read";
import { logDetail, lookupWeather } from "@/lib/services/logs";

function hoursValue(minutes: number | null) {
  if (minutes == null) return "";
  return String(minutes / 60);
}

export default async function DailyLogPage({ params }: { params: Promise<{ id: string; logId: string }> }) {
  const { id, logId } = await params;
  const session = await requireSession();
  const detail = logDetail(session, logId);
  if (!detail || detail.project.id !== id) return <MissingRecord orgName={session.orgName} kind="log" />;
  const log = detail.log;
  lookupWeather();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">Daily log</h1>
        <p className="text-sm text-muted-foreground">
          {detail.authorName} · {formatCalendarDay(log.logDate)} · {log.status} · {log.visibility === "client" ? "on the client portal" : "internal"}
        </p>
        <div className="mt-3">
          <JobTabs projectId={id} current="logs" />
        </div>
      </div>
      <section className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
        <h2 className="font-medium">Crew on this job</h2>
        <p className="mt-1 text-muted-foreground">
          {detail.crew.headcount} {detail.crew.headcount === 1 ? "person" : "people"} · {detail.crew.hoursLabel}
          {detail.crew.includesUnapproved ? " · includes punches not approved yet" : ""}
        </p>
        <ul className="mt-2">
          {detail.crew.byCode.map((row) => (
            <li key={row.costCode}>
              {row.costCode} · {Math.floor(row.minutes / 60)}h {String(row.minutes % 60).padStart(2, "0")}m
            </li>
          ))}
        </ul>
      </section>
      {detail.canEdit ? (
        <LogDraftSaver action={saveLogAction.bind(null, log.id)} scope={{ orgId: session.orgId, userId: session.userId }} projectId={log.projectId}>
          <label className="text-sm">
            Notes
            <textarea name="notes" rows={4} required={log.status === "published"} defaultValue={log.notes ?? ""} className="field mt-1" placeholder="What got done" />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Weather, delays, and the rest</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Type the sky and temperature. Fieldline does not call a weather service.</p>
              <label>
                Planned next
                <textarea name="plannedNext" rows={2} defaultValue={log.plannedNext ?? ""} className="field mt-1" />
              </label>
              <label>
                Sky
                <input name="weatherSky" defaultValue={log.weatherSky ?? ""} className="field mt-1" placeholder="Clear, rain, wind" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  High °F
                  <input name="weatherHighF" inputMode="numeric" defaultValue={log.weatherHighF ?? ""} className="field mt-1" />
                </label>
                <label>
                  Low °F
                  <input name="weatherLowF" inputMode="numeric" defaultValue={log.weatherLowF ?? ""} className="field mt-1" />
                </label>
              </div>
              <label>
                Hours lost to weather
                <input name="weatherLostHours" inputMode="decimal" defaultValue={hoursValue(log.weatherLostMinutes)} className="field mt-1" />
              </label>
              <label>
                Weather impact
                <textarea name="weatherImpact" rows={2} defaultValue={log.weatherImpact ?? ""} className="field mt-1" />
              </label>
              <label>
                Delay cause
                <input name="delayCause" defaultValue={log.delayCause ?? ""} className="field mt-1" />
              </label>
              <label>
                Delay hours
                <input name="delayHours" inputMode="decimal" defaultValue={hoursValue(log.delayMinutes)} className="field mt-1" />
              </label>
              <label>
                Deliveries
                <textarea name="deliveries" rows={2} defaultValue={log.deliveries ?? ""} className="field mt-1" />
              </label>
              <label>
                Inspections and visitors
                <textarea name="visitors" rows={2} defaultValue={log.visitors ?? ""} className="field mt-1" />
              </label>
              <label>
                Safety note
                <textarea name="safetyNote" rows={2} defaultValue={log.safetyNote ?? ""} className="field mt-1" />
              </label>
            </div>
          </details>
          <Button type="submit" name="intent" value="draft" variant="outline" className="h-12">
            {log.status === "published" ? "Save changes" : "Save draft"}
          </Button>
          {log.status === "draft" ? (
            <Button type="submit" name="intent" value="publish" className="h-14 text-base">
              Publish log
            </Button>
          ) : null}
        </LogDraftSaver>
      ) : (
        <article className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
          <p className="whitespace-pre-wrap">{log.notes}</p>
          {log.visibility === "client" && session.role === "field" ? (
            <p className="mt-2 text-xs text-muted-foreground">The office owns this log once it is on the client portal.</p>
          ) : null}
        </article>
      )}
      {log.status !== "void" ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">Photos</h2>
          <p className="mt-1 text-xs text-muted-foreground">Photos need a connection. They are not saved on this phone.</p>
          <ul className="mt-2 space-y-2 text-sm">
            {detail.photos.map((photo) => (
              <li key={photo.id}>
                <Link href={`/api/files/${photo.id}`}>{captionFromMetadata(photo.metadataJson) || photo.filename}</Link>
              </li>
            ))}
          </ul>
          {detail.canEdit ? <PhotoCapture action={logPhotoAction.bind(null, log.id)} label="Add a log photo" submitLabel="Save photo on the log" /> : null}
        </section>
      ) : null}
      {detail.canShare ? (
        <ActionForm action={shareLogAction.bind(null, log.id)}>
          <input type="hidden" name="visibility" value={log.visibility === "client" ? "internal" : "client"} />
          <Button type="submit" className="h-12">
            {log.visibility === "client" ? "Hide from the client portal" : "Show on the client portal"}
          </Button>
        </ActionForm>
      ) : null}
      {log.status !== "void" && (detail.canEdit || detail.canShare) ? (
        <ActionForm action={voidLogAction.bind(null, log.id)} className="flex flex-col gap-2">
          <label className="text-sm">
            Reason to void
            <input name="reason" required className="field mt-1" placeholder="Why this log should come off the record" />
          </label>
          <Button type="submit" variant="outline" className="h-12">
            Void log
          </Button>
        </ActionForm>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">History</summary>
        <ul className="mt-2 space-y-2">
          {detail.events.map(({ event, actorName }) => (
            <li key={event.id} className="rounded-lg bg-muted px-3 py-2">
              <span className="font-medium">{event.type}</span> · {actorName || "Someone"} · {event.createdAt}
              {event.reason ? <span className="block">{event.reason}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
