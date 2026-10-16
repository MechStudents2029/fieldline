import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { publicMeeting } from "@/lib/services/meetings";

export const dynamic = "force-dynamic";

export default async function PublicMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const meeting = publicMeeting(token);
  if (!meeting) notFound();
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-white px-6 py-8 text-[13px] text-black">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-wide">{meeting.orgName}</p>
        <h1 className="text-[22px] font-semibold">{meeting.approved ? "Minutes" : "Agenda"}</h1>
        <p>
          {meeting.job} · {meeting.title} #{meeting.number}
        </p>
        <p>
          {meeting.kindLabel} · {meeting.meetOn}
          {meeting.startTime ? ` · ${meeting.startTime}` : ""}
          {meeting.location ? ` · ${meeting.location}` : ""}
        </p>
        <p>{meeting.statusLabel}</p>
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
            {item.notes ? <p>{item.notes}</p> : null}
            {item.decision ? <p>{item.decision}</p> : null}
          </li>
        ))}
      </ol>
      {meeting.approved ? (
        <section className="mt-6" aria-label="Actions">
          <h2 className="mb-2 text-sm font-semibold">Actions</h2>
          <ul>
            {meeting.actions.map((action) => (
              <li key={action.id}>
                {action.title} · {action.assignee}
                {action.dueOn ? ` · ${action.dueOn}` : ""} · {action.status === "done" ? "Done" : "Open"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
