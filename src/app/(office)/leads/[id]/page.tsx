import Link from "next/link";
import { generateEstimateAction, leadPhotoAction, moveLeadFormAction, noteAction, taskAction } from "@/app/actions";
import { MissingRecord } from "@/components/missing-record";
import { ActionForm } from "@/components/action-form";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { WEBSITE_FORM_SOURCE } from "@/lib/lead-form/rules";
import { canSeeMoney } from "@/lib/permissions";
import { markWebLeadOpened, webLeadSubmission } from "@/lib/services/lead-form";
import { captionFromMetadata, leadDetail, pipelineBoard } from "@/lib/services/read";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = leadDetail(session.orgId, id);
  if (!detail?.contact) return <MissingRecord orgName={session.orgName} kind="lead" />;
  const board = pipelineBoard(session.orgId);
  const money = canSeeMoney(session.role);
  const web = detail.lead.source === WEBSITE_FORM_SOURCE ? webLeadSubmission(session.orgId, detail.lead.id) : null;
  if (web) markWebLeadOpened(session.orgId, detail.lead.id);
  const answers = web
    ? (
        [
          ["Email", web.answers.email],
          ["Phone", web.answers.phone],
          ["Address", web.answers.address],
          ["Project type", web.answers.projectType],
          ["Budget", web.answers.budget],
          ["Timeline", web.answers.timeline],
          ["Description", web.answers.description],
        ] as const
      ).filter((row) => row[1])
    : [];
  const latest = detail.estimates.find((estimate) => estimate.status !== "void");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>{detail.stage?.name} · {detail.lead.source}</span>
          {web ? <span className="fl-pill normal-case">Website form</span> : null}
        </p>
        <h1 className="font-heading text-3xl">{detail.lead.title}</h1>
        <p className="text-sm">
          <Link href={`/contacts/${detail.contact.id}`} className="underline">
            {detail.contact.name}
          </Link>
          {detail.contact.phone ? ` · ${detail.contact.phone}` : ""}
          {detail.contact.email ? ` · ${detail.contact.email}` : ""}
        </p>
        {money && detail.lead.valueEstCents != null ? <p className="mt-1 text-sm">Named budget {formatMoney(detail.lead.valueEstCents)}</p> : null}
      </div>
      <ActionForm action={moveLeadFormAction.bind(null, detail.lead.id)} className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          Stage
          <select name="stageId" defaultValue={detail.lead.stageId} className="field mt-1">
            {board.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11">
          Update
        </Button>
      </ActionForm>
      {web ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-semibold">Website form</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            {answers.map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <dt className="w-28 shrink-0 text-[var(--mac-secondary)]">{label}</dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
          {web.attribution ? <p className="mt-2 text-sm text-[var(--mac-secondary)]">{web.attribution}</p> : null}
        </section>
      ) : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Scope</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{detail.lead.scopeText || "No scope yet."}</p>
        {detail.photos.some((photo) => photo.type === "photo") ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {detail.photos.filter((photo) => photo.type === "photo").map((photo) => (
              <img key={photo.id} src={photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}`} alt={captionFromMetadata(photo.metadataJson) || "Site photo"} className="aspect-[4/3] w-full rounded-lg object-cover" />
            ))}
          </div>
        ) : null}
        {session.role !== "viewer" ? (
          <PhotoCapture action={leadPhotoAction.bind(null, detail.lead.id)} label="Take an estimate photo" submitLabel="Save site photo" />
        ) : null}
        {detail.estimates.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No estimate yet. An estimate is a priced version of this scope, using your price book. This lead has none yet.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {session.role !== "field" && session.role !== "viewer" ? (
            <ActionForm action={generateEstimateAction.bind(null, detail.lead.id)}>
              <Button type="submit" className="h-11">
                Draft estimate from price book
              </Button>
            </ActionForm>
          ) : null}
          {latest ? (
            <Button asChild variant="outline" className="h-11">
              <Link href={`/estimates/${latest.id}`}>Open estimate v{latest.version}</Link>
            </Button>
          ) : null}
        </div>
      </section>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Proposals</h2>
        {detail.proposals.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing sent yet.</p> : null}
        <ul className="mt-2 space-y-2 text-sm">
          {detail.proposals.map((proposal) => (
            <li key={proposal.id} className="flex items-center justify-between gap-2">
              <Link href={`/p/${proposal.publicToken}`} className="underline">
                {proposal.status}
              </Link>
              <span>{money ? formatMoney(proposal.totalCents) : "Hidden"}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">Log a call or note</h2>
          <ActionForm action={noteAction.bind(null, "lead", detail.lead.id)} className="mt-2 flex flex-col gap-2">
            <textarea name="summary" rows={3} className="w-full rounded-lg border border-input bg-background p-3" placeholder="Called, left a voicemail about the quartz edge." />
            <Button type="submit" variant="outline">
              Add to timeline
            </Button>
          </ActionForm>
        </div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">Task</h2>
          <ActionForm action={taskAction.bind(null, "lead", detail.lead.id)} className="mt-2 flex flex-col gap-2">
            <input name="title" className="field" placeholder="Measure the backsplash" />
            <input name="due" type="date" className="field" />
            <Button type="submit" variant="outline">
              Assign task
            </Button>
          </ActionForm>
          <ul className="mt-3 text-sm">
            {detail.tasks.map((task) => (
              <li key={task.id}>
                {task.title} · {task.status}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section>
        <h2 className="font-medium">Timeline</h2>
        <ul className="mt-2 space-y-3">
          {detail.timeline.map((item) => (
            <li key={item.id} className="text-sm">
              <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)} · {item.type}</span>
              <p>{item.summary}</p>
            </li>
          ))}
          {detail.messages.map((message) => (
            <li key={message.id} className="text-sm">
              <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)} · {message.direction} {message.channel}</span>
              <p className="whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
