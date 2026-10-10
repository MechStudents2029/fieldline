import Link from "next/link";
import { TalkSignForm } from "@/components/talk-sign-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { talkView } from "@/lib/services/safety";

export default async function TalkPage({ params }: { params: Promise<{ id: string; talkId: string }> }) {
  const { id, talkId } = await params;
  const session = await requireSession();
  const talk = talkView(session, talkId);
  if (!talk || talk.projectId !== id) {
    return (
      <div className="px-6 py-6">
        <h1 className="mac-t15">Not found</h1>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title={talk.title}
        subtitle={talk.projectName}
        search={false}
        leading={
          <Link href={`/projects/${id}/safety`} className="ctl">
            Safety
          </Link>
        }
      />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="fl-pill" data-status={talk.status}>
            {talk.statusLabel}
          </span>
          <span className="num mac-t13">{formatCalendarDay(talk.scheduledOn)}</span>
          <span className="mac-t13 text-[var(--mac-secondary)]">{talk.leader}</span>
        </div>
        <p>{talk.body}</p>
        {talk.bodyEs ? <p lang="es">{talk.bodyEs}</p> : null}
        {talk.locked ? (
          <ul aria-label="Attendees">
            {talk.attendees.map((person) => (
              <li key={person.id} className="mac-t13">
                {person.name}
                {person.visitor ? " · Visitor" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {talk.canSign ? <TalkSignForm talkId={talk.id} projectId={talk.projectId} crew={talk.crew} scope={{ orgId: session.orgId, userId: session.userId }} /> : null}
      </div>
    </div>
  );
}
