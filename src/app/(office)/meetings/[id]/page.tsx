import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addActionItem,
  addItemAction,
  approveMinutesAction,
  createActionTodoAction,
  followUpAction,
  markDistributedAction,
  reviseMeetingAction,
  saveItemAction,
  setActionStatusAction,
  startMinutesAction,
} from "@/app/(office)/meetings/actions";
import { ActionForm } from "@/components/action-form";
import { CopyLink } from "@/components/copy-link";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { meetingDetail } from "@/lib/services/meetings";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const meeting = meetingDetail(session, id);
  if (!meeting) notFound();
  const office = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={meeting.title} subtitle={String(meeting.number)} search={false} leading={<Link href={`/projects/${meeting.projectId}/meetings`}>‹</Link>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">{meeting.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="fl-pill" data-status={meeting.status}>
            {meeting.statusLabel}
          </span>
          <span className="fl-pill">{meeting.kindLabel}</span>
          <span className="num text-sm">{meeting.meetOn}{meeting.startTime ? ` ${meeting.startTime}` : ""}</span>
          {meeting.location ? <span className="text-sm">{meeting.location}</span> : null}
          <Link href={`/meetings/${meeting.id}/print?view=agenda`} className="text-[var(--mac-accent)]">
            Agenda
          </Link>
          <Link href={`/meetings/${meeting.id}/print?view=minutes`} className="text-[var(--mac-accent)]">
            Minutes
          </Link>
        </div>
        {office ? (
          <div className="flex flex-col gap-3">
            <CopyLink url={meeting.shareUrl} label="Share link" />
            <div className="flex flex-wrap items-center gap-2">
              {meeting.status === "agenda" ? (
                <ActionForm action={startMinutesAction.bind(null, meeting.id)}>
                  <Button type="submit">Start minutes</Button>
                </ActionForm>
              ) : null}
              {meeting.status === "minutes" ? (
                <ActionForm action={approveMinutesAction.bind(null, meeting.id)}>
                  <Button type="submit">Approve</Button>
                </ActionForm>
              ) : null}
              {meeting.status === "approved" ? (
                <ActionForm action={reviseMeetingAction.bind(null, meeting.id)}>
                  <Button type="submit" variant="secondary">
                    Revise
                  </Button>
                </ActionForm>
              ) : null}
              <ActionForm action={followUpAction.bind(null, meeting.id)} className="flex items-center gap-2">
                <input type="date" name="meetOn" aria-label="Follow-up date" className="field w-auto" />
                <Button type="submit" variant="secondary">
                  Follow-up
                </Button>
              </ActionForm>
              <ActionForm action={markDistributedAction.bind(null, meeting.id)}>
                <Button type="submit" variant="secondary">
                  Mark distributed
                </Button>
              </ActionForm>
            </div>
            {meeting.distributedAt ? (
              <p className="text-[12px] text-[var(--mac-secondary)]">
                {meeting.distributedByName} {meeting.distributedAt.slice(0, 10)}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <section aria-label="Attendees">
            <h2 className="fl-section">Attendees</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {meeting.attendees.map((attendee) => (
                <li key={attendee.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{attendee.name}</span>
                  <span className="fl-pill" data-presence={attendee.presence}>
                    {attendee.presence === "present" ? "Present" : "Absent"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Agenda" className="flex flex-col gap-4">
            {meeting.editable ? (
              <ActionForm action={addItemAction.bind(null, meeting.id)} className="flex flex-wrap items-end gap-2">
                <input name="title" aria-label="Agenda item" className="field min-w-40 flex-1" required />
                <select name="link" aria-label="Link" className="field w-auto" defaultValue="">
                  <option value="">Link</option>
                  {meeting.links.map((link) => (
                    <option key={link.value} value={link.value}>
                      {link.label}
                    </option>
                  ))}
                </select>
                <Button type="submit">Add item</Button>
              </ActionForm>
            ) : null}
            {meeting.items.map((item) => (
              <article key={item.id} data-item={item.title} className="border-t border-[var(--mac-separator)] pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium">{item.title}</h2>
                  {item.sourceLabel ? <span className="fl-pill">{item.sourceLabel}</span> : null}
                  {item.linkLabel ? <span className="text-[12px] text-[var(--mac-secondary)]">{item.linkLabel}</span> : null}
                  <span className="fl-pill">{item.itemStatus === "closed" ? "Closed" : "Open"}</span>
                </div>
                {meeting.editable ? (
                  <ActionForm action={saveItemAction.bind(null, item.id)} className="mt-2 flex flex-col gap-2">
                    <textarea name="notes" aria-label={`Notes ${item.title}`} defaultValue={item.notes} rows={2} className="field" />
                    <input name="decision" aria-label={`Decision ${item.title}`} defaultValue={item.decision} className="field" />
                    <select name="itemStatus" aria-label={`Item status ${item.title}`} defaultValue={item.itemStatus} className="field w-auto">
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                    <Button type="submit" variant="secondary">
                      Save item
                    </Button>
                  </ActionForm>
                ) : (
                  <div className="mt-2 text-sm">
                    {item.notes ? <p>{item.notes}</p> : null}
                    {item.decision ? <p>{item.decision}</p> : null}
                  </div>
                )}
                <table aria-label={`Actions ${item.title}`} className="mt-3 w-full text-left text-sm">
                  <tbody>
                    {item.actions.map((action) => (
                      <tr key={action.id} data-action={action.title} className="border-t border-[var(--mac-separator)]">
                        <td className="py-2 pr-3">
                          {action.title}
                          {action.sourceLabel ? <span className="ml-2 fl-pill">{action.sourceLabel}</span> : null}
                        </td>
                        <td className="py-2 pr-3">{action.assignee}</td>
                        <td className="py-2 pr-3 num">{action.dueOn}</td>
                        <td className="py-2 pr-3">
                          <span className="fl-pill" data-action-status={action.status}>
                            {action.status === "done" ? "Done" : "Open"}
                          </span>
                        </td>
                        <td className="py-2">
                          {meeting.editable ? (
                            <div className="flex flex-wrap gap-2">
                              <ActionForm action={setActionStatusAction.bind(null, action.id, action.status === "done" ? "open" : "done")}>
                                <Button type="submit" variant="secondary">
                                  {action.status === "done" ? "Reopen" : "Done"}
                                </Button>
                              </ActionForm>
                              {action.todoId ? (
                                <Link href="/todos" className="text-[var(--mac-accent)]">
                                  To-do
                                </Link>
                              ) : (
                                <ActionForm action={createActionTodoAction.bind(null, action.id)}>
                                  <Button type="submit" variant="secondary">
                                    To-do
                                  </Button>
                                </ActionForm>
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {meeting.editable ? (
                  <ActionForm action={addActionItem.bind(null, item.id)} className="mt-2 flex flex-wrap items-end gap-2">
                    <input name="title" aria-label={`Action ${item.title}`} className="field min-w-32 flex-1" required />
                    <select name="assignee" aria-label={`Assignee ${item.title}`} className="field w-auto" required defaultValue="">
                      <option value="">Assignee</option>
                      {meeting.assignees.map((person) => (
                        <option key={person.value} value={person.value}>
                          {person.label}
                        </option>
                      ))}
                    </select>
                    <input type="date" name="dueOn" aria-label={`Due ${item.title}`} className="field w-auto" />
                    <Button type="submit">Add action</Button>
                  </ActionForm>
                ) : null}
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
