import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { meetingDetail } from "@/lib/services/meetings";

export default async function MeetingPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  const meeting = meetingDetail(session, id);
  if (!meeting) notFound();
  const minutes = query.view === "minutes";
  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-[13px] text-black print:px-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/meetings/${meeting.id}`} className="text-[var(--fl-accent)]">
          ‹ {meeting.title}
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-wide">{meeting.kindLabel}</p>
        <h1 className="text-[22px] font-semibold">{minutes ? "Minutes" : "Agenda"}</h1>
        <p>
          {meeting.job} · {meeting.title} #{meeting.number}
        </p>
        <p>
          {meeting.meetOn}
          {meeting.startTime ? ` · ${meeting.startTime}` : ""}
          {meeting.location ? ` · ${meeting.location}` : ""}
        </p>
      </header>
      <h2 className="mb-2 text-sm font-semibold">Attendees</h2>
      <ul className="mb-6">
        {meeting.attendees.map((attendee) => (
          <li key={attendee.id}>
            {attendee.name} · {attendee.presence === "present" ? "Present" : "Absent"}
          </li>
        ))}
      </ul>
      <ol className="flex flex-col gap-4">
        {meeting.items.map((item, index) => (
          <li key={item.id}>
            <p className="font-medium">
              {index + 1}. {item.title}
              {item.sourceLabel ? ` · ${item.sourceLabel}` : ""}
            </p>
            {minutes && item.notes ? <p>{item.notes}</p> : null}
            {minutes && item.decision ? <p>Decision: {item.decision}</p> : null}
            {minutes ? (
              <ul>
                {item.actions.map((action) => (
                  <li key={action.id}>
                    {action.title} · {action.assignee}
                    {action.dueOn ? ` · ${action.dueOn}` : ""} · {action.status === "done" ? "Done" : "Open"}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  );
}
