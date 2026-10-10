import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ChecklistForm } from "@/components/checklist-form";
import { FileButton } from "@/components/file-button";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { createIncidentAction, linkCheckPunchAction, linkCheckTodoAction, scheduleTalkAction } from "@/app/(office)/safety/actions";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { jobSafety } from "@/lib/services/safety";
import { calendarForOrg } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

function officeDay(orgId: string) {
  return localDay(Date.now(), calendarForOrg(orgId).timeZone);
}

export default async function JobSafetyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const board = jobSafety(session, id);
  if (!board) {
    return (
      <div className="px-6 py-6">
        <h1 className="mac-t15">Not found</h1>
      </div>
    );
  }
  const query = await searchParams;
  const mode = one(query.new);
  const today = officeDay(session.orgId);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          title="Safety"
          subtitle={`${board.counts.talks + board.counts.checks + board.counts.incidents}`}
          search={false}
          center={jobSectionTabs(id, "safety")}
          trailing={
            board.canWrite ? (
              <span className="flex items-center gap-2">
                {board.canSchedule ? (
                  <Link href={`/projects/${id}/safety?new=talk`} className="ctl">
                    Talk
                  </Link>
                ) : null}
                <Link href={`/projects/${id}/safety?new=check`} className="ctl">
                  Checklist
                </Link>
                <Link href={`/projects/${id}/safety?new=incident`} className="ctl">
                  Incident
                </Link>
              </span>
            ) : null
          }
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
          <section aria-label="Talks" className="mb-6">
            <h2 className="mac-t11 mb-2 font-semibold text-[var(--mac-secondary)]">Talks</h2>
            {board.talks.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No talks</p> : null}
            <table className="mac-table w-full">
              <tbody>
                {board.talks.map((talk) => (
                  <tr key={talk.id} data-mac-row={talk.title}>
                    <td>
                      <Link href={talk.href}>{talk.title}</Link>
                    </td>
                    <td className="num">{formatCalendarDay(talk.when)}</td>
                    <td>
                      <span className="fl-pill" data-status={talk.status}>
                        {talk.statusLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-label="Checklists" className="mb-6">
            <h2 className="mac-t11 mb-2 font-semibold text-[var(--mac-secondary)]">Checklists</h2>
            {board.checks.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No checklists</p> : null}
            {board.checks.map((check) => (
              <div key={check.id} className="mb-3" data-check={check.id}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="mac-t13">{check.title}</span>
                  <span className="fl-pill">{check.statusLabel}</span>
                  <span className="num mac-t11 text-[var(--mac-secondary)]">{formatCalendarDay(check.when)}</span>
                </div>
                <ul>
                  {check.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate mac-t13">{item.title}</span>
                      <span className="fl-pill">{item.result === "na" ? "N/A" : item.result === "fail" ? "Fail" : "Pass"}</span>
                      {item.result === "fail" && board.canWrite && !item.todoId ? (
                        <form action={linkCheckTodoAction.bind(null, item.id)}>
                          <input type="hidden" name="projectId" value={id} />
                          <button type="submit" className="ctl">
                            To-do
                          </button>
                        </form>
                      ) : null}
                      {item.todoId ? (
                        <Link href="/todos" className="ctl">
                          To-do
                        </Link>
                      ) : null}
                      {item.result === "fail" && board.canWrite && !item.punchId ? (
                        <form action={linkCheckPunchAction.bind(null, item.id)}>
                          <input type="hidden" name="projectId" value={id} />
                          <button type="submit" className="ctl">
                            Punch
                          </button>
                        </form>
                      ) : null}
                      {item.punchId ? (
                        <Link href={`/projects/${id}#punch`} className="ctl">
                          Punch
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <section aria-label="Incidents">
            <h2 className="mac-t11 mb-2 font-semibold text-[var(--mac-secondary)]">Incidents</h2>
            {board.incidents.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No incidents</p> : null}
            <ul>
              {board.incidents.map((incident) => (
                <li key={incident.id} className="flex items-center gap-2 py-1">
                  <Link href={incident.href} className="min-w-0 flex-1 truncate">
                    {incident.title}
                  </Link>
                  <span className="mac-t11 text-[var(--mac-secondary)]">{incident.kindLabel}</span>
                  <span className="fl-pill">{incident.statusLabel}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {mode === "talk" && board.canSchedule ? (
        <aside className="w-full shrink-0 border-l border-[var(--mac-separator)] p-4 md:w-[420px]">
          <ActionForm action={scheduleTalkAction} className="flex flex-col gap-3" dataSheet="talk">
            <input type="hidden" name="projectId" value={id} />
            <div className="ctl-line">
              <span>Topic</span>
              <select name="topicId" aria-label="Topic" className="ctl" defaultValue={board.topics[0]?.id}>
                {board.topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="ctl-line">
              <span>Date</span>
              <input name="scheduledOn" aria-label="Date" type="date" required defaultValue={today} className="ctl" />
            </div>
            <div className="ctl-line">
              <span>Leader</span>
              <select name="leaderUserId" aria-label="Leader" className="ctl" defaultValue={board.people[0]?.id}>
                {board.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="mac-primary w-fit">
                Save
              </button>
              <Link href={`/projects/${id}/safety`} className="ctl">
                Cancel
              </Link>
            </div>
          </ActionForm>
        </aside>
      ) : null}
      {mode === "check" && board.canWrite ? (
        <aside className="w-full shrink-0 overflow-auto border-l border-[var(--mac-separator)] p-4 md:w-[420px]">
          <ChecklistForm projectId={id} templates={board.templates} />
          <Link href={`/projects/${id}/safety`} className="ctl mt-3 inline-flex">
            Cancel
          </Link>
        </aside>
      ) : null}
      {mode === "incident" && board.canWrite ? (
        <aside className="w-full shrink-0 overflow-auto border-l border-[var(--mac-separator)] p-4 md:w-[420px]">
          <ActionForm action={createIncidentAction} className="flex flex-col gap-3" dataSheet="incident">
            <input type="hidden" name="projectId" value={id} />
            <div className="ctl-line">
              <span>Type</span>
              <select name="kind" aria-label="Type" className="ctl" defaultValue="near_miss">
                <option value="near_miss">Near miss</option>
                <option value="first_aid">First aid</option>
                <option value="recordable">Recordable</option>
                <option value="property">Property damage</option>
                <option value="equipment">Equipment failure</option>
              </select>
            </div>
            <label className="text-[13px]">
              When
              <input name="occurredAt" aria-label="When" type="datetime-local" required className="field mt-1" />
            </label>
            <label className="text-[13px]">
              People
              <textarea name="people" aria-label="People" required className="field mt-1" rows={2} />
            </label>
            <label className="text-[13px]">
              Description
              <textarea name="description" aria-label="Description" required className="field mt-1" rows={3} />
            </label>
            <label className="text-[13px]">
              Factors
              <textarea name="factors" aria-label="Factors" className="field mt-1" rows={2} />
            </label>
            <div className="ctl-line">
              <span>Equipment</span>
              <select name="equipmentId" aria-label="Equipment" className="ctl" defaultValue="">
                <option value="">None</option>
                {board.gear.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <FileButton name="photo" label="Photo" accept="image/jpeg,image/png,image/webp" multiple empty="Photo" />
            <input name="actionTitle" aria-label="Corrective action" placeholder="Corrective action" className="field" />
            <div className="ctl-line">
              <span>Assign</span>
              <select name="assigneeUserId" aria-label="Assign" className="ctl" defaultValue={session.userId}>
                {board.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="mac-primary w-fit">
                Save
              </button>
              <Link href={`/projects/${id}/safety`} className="ctl">
                Cancel
              </Link>
            </div>
          </ActionForm>
        </aside>
      ) : null}
    </div>
  );
}
