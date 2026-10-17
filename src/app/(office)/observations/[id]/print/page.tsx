import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { observationDetail } from "@/lib/services/observations";

export default async function ObservationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = observationDetail(session, id);
  if (!detail) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-8 text-sm">
      <h1 className="text-2xl">{detail.title}</h1>
      <p className="mt-1 tabular-nums">
        {detail.number} · {detail.job}
      </p>
      <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-y-1">
        <dt>Type</dt>
        <dd>{detail.typeLabel}</dd>
        <dt>Priority</dt>
        <dd>{detail.priorityLabel}</dd>
        <dt>Status</dt>
        <dd>{detail.statusLabel}</dd>
        <dt>Vendor</dt>
        <dd>{detail.vendor || detail.assignee}</dd>
        <dt>Due</dt>
        <dd className="tabular-nums">{detail.dueDate ?? ""}</dd>
        <dt>Room</dt>
        <dd>{detail.location}</dd>
        <dt>Trade</dt>
        <dd>{detail.trade}</dd>
        <dt>Hazard</dt>
        <dd>{detail.hazard}</dd>
        <dt>Cost code</dt>
        <dd>{detail.costCode ?? ""}</dd>
      </dl>
      {detail.description ? <p className="mt-4 whitespace-pre-line">{detail.description}</p> : null}
      {detail.rejectNote ? <p className="mt-4">{detail.rejectNote}</p> : null}
      <ol className="mt-6">
        {detail.events.map((event) => (
          <li key={event.id}>
            {event.label} · {event.actorName} · {event.createdAt.slice(0, 16).replace("T", " ")}
            {event.note ? ` · ${event.note}` : ""}
          </li>
        ))}
      </ol>
    </main>
  );
}
