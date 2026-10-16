import { acknowledgeTransmittalAction, declineTransmittalAction } from "@/app/(office)/transmittals/actions";
import { ActionForm } from "@/components/action-form";
import { publicTransmittal } from "@/lib/services/transmittals";

export const dynamic = "force-dynamic";

function txStarted() {
  return Date.now();
}

export default async function PublicTransmittalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = publicTransmittal(token);
  if (page.state === "missing") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <h1 className="font-heading text-2xl">Transmittal</h1>
        <p className="mt-3 text-base">That package is not here.</p>
      </main>
    );
  }
  if (page.state === "closed") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16" data-status="closed">
        <div className="mb-6 h-1 w-10 bg-[var(--fl-accent)]" />
        <h1 className="font-heading text-2xl">{page.orgName}</h1>
        <p className="mt-2 text-sm">{page.subject}</p>
        <p className="mt-3 text-base">{page.line}</p>
      </main>
    );
  }
  const started = txStarted();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10" data-status={page.status}>
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{page.orgName}</h1>
      <p className="mt-2 text-sm">{page.subject}</p>
      <p className="mt-1 text-sm">
        {page.toName} · {page.purposeLabel} · {page.dateLabel}
      </p>
      <ol className="mt-4">
        {page.lines.map((line, index) => (
          <li key={line.id} className="mt-2 text-sm">
            <span className="num">{index + 1}. </span>
            {line.href ? (
              <a href={line.href} className="text-[var(--mac-accent)]">
                {line.title}
              </a>
            ) : (
              line.title
            )}
            {line.returnRequired ? <span className="num"> · 1</span> : null}
          </li>
        ))}
      </ol>
      {page.ackName ? (
        <p className="mt-4 text-sm" data-ack={page.ackName}>
          {page.ackName}
          {page.ackNote ? ` · ${page.ackNote}` : ""}
        </p>
      ) : null}
      {page.declineReason ? (
        <p className="mt-4 text-sm" data-decline={page.declineReason}>
          {page.declineReason}
        </p>
      ) : null}
      {page.state === "open" ? (
        <>
          <ActionForm action={acknowledgeTransmittalAction.bind(null, page.token)} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="startedAt" value={String(started)} />
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
              <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>
            <label className="text-sm">
              Name
              <input name="name" aria-label="Name" required className="field mt-1" />
            </label>
            <label className="text-sm">
              Note
              <input name="note" aria-label="Note" className="field mt-1" />
            </label>
            <button type="submit" className="ctl h-9 w-fit">
              Acknowledge
            </button>
          </ActionForm>
          <ActionForm action={declineTransmittalAction.bind(null, page.token)} className="mt-6 flex flex-col gap-2">
            <input type="hidden" name="startedAt" value={String(started)} />
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
              <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>
            <label className="text-sm">
              Reason
              <input name="reason" aria-label="Reason" className="field mt-1" />
            </label>
            <button type="submit" className="ctl h-9 w-fit">
              Decline
            </button>
          </ActionForm>
        </>
      ) : null}
    </main>
  );
}
