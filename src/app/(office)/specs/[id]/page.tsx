import Link from "next/link";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import {
  addSpecLineAction,
  attachSpecFileAction,
  keepSpecLineAction,
  markSpecSentAction,
  moveSpecLineAction,
  publishSpecAction,
  pullSpecLinesAction,
  refreshSpecLineAction,
  reviseSpecAction,
  saveSpecLineAction,
  updateSpecAction,
} from "@/app/(office)/specs/actions";
import { ActionForm } from "@/components/action-form";
import { CopyField } from "@/components/copy-field";
import { FileButton } from "@/components/file-button";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { specPack } from "@/lib/services/job-specs";

export default async function SpecDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const pack = specPack(session, id);
  if (!pack) notFound();
  const svg = await QRCode.toString(pack.link, { type: "svg", margin: 0, width: 96 });
  const draft = pack.canEdit && pack.latest && pack.status === "draft";
  const field = session.role === "field";
  const groups: { label: string; lines: typeof pack.lines }[] = [];
  for (const line of pack.lines) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== line.groupLabel) groups.push({ label: line.groupLabel, lines: [line] });
    else last.lines.push(line);
  }
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col" data-status={pack.status} data-version={pack.version} data-spec={pack.id}>
      <div className="hidden md:block">
        <Toolbar title={pack.title} subtitle={`v${pack.version}`} search={false} leading={<Link href={`/projects/${pack.projectId}/specs`}>‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">{pack.title}</h1>
        <p className="text-sm">
          <Link href={`/projects/${pack.projectId}`} className="text-[var(--mac-secondary)]">
            {pack.projectName}
          </Link>
          <span className="fl-pill ml-2">{pack.status === "published" ? "Published" : "Draft"}</span>
          <span className="num ml-2">v{pack.version}</span>
          {pack.dueOn ? <span className="num ml-2">{pack.dueOn}</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {pack.versions.map((version) => (
            <Link key={version.id} href={`/specs/${version.id}`} className="text-sm" data-history={version.version}>
              v{version.version}
              <span className="fl-pill ml-1">{version.status === "published" ? "Published" : "Draft"}</span>
            </Link>
          ))}
        </div>
        {draft ? (
          <ActionForm action={updateSpecAction.bind(null, pack.id)} className="flex flex-col gap-2">
            <label className="text-sm">
              Title
              <input name="title" aria-label="Title" defaultValue={pack.title} className="field mt-1" />
            </label>
            <label className="text-sm">
              Due
              <input name="dueOn" type="date" aria-label="Due" defaultValue={pack.dueOn ?? ""} className="field mt-1" />
            </label>
            <button type="submit" className="ctl h-9 w-fit">
              Save
            </button>
          </ActionForm>
        ) : null}
        <CopyField label="Link" value={pack.link} />
        <div data-qr dangerouslySetInnerHTML={{ __html: svg }} />
        {pack.sentAt ? (
          <p className="num text-sm" data-sent={pack.sentAt}>
            {pack.sentAt.slice(0, 10)}
          </p>
        ) : null}
        {pack.canEdit && pack.status === "published" ? (
          <ActionForm action={markSpecSentAction.bind(null, pack.id)}>
            <button type="submit" className="ctl h-9">
              Mark sent
            </button>
          </ActionForm>
        ) : null}
        {draft ? (
          <ActionForm action={publishSpecAction.bind(null, pack.id)}>
            <button type="submit" className="ctl h-9">
              Publish
            </button>
          </ActionForm>
        ) : null}
        {pack.canEdit && pack.latest && pack.status === "published" ? (
          <ActionForm action={reviseSpecAction.bind(null, pack.id)}>
            <button type="submit" className="ctl h-9">
              Revise
            </button>
          </ActionForm>
        ) : null}
        {draft && pack.unlinked > 0 ? (
          <ActionForm action={pullSpecLinesAction.bind(null, pack.id)} className="flex items-center gap-2">
            <span className="num">{pack.unlinked}</span>
            <button type="submit" className="ctl h-9">
              Pull
            </button>
          </ActionForm>
        ) : null}
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="text-sm text-[var(--mac-secondary)]">{group.label}</h2>
            <ul className="mt-2 flex flex-col gap-4">
              {group.lines.map((line) => (
                <li key={line.id} data-line={line.id} data-flag={line.changed ? "changed" : undefined}>
                  <p className="text-sm">
                    {line.costCode ? <span className="num mr-2">{line.costCode}</span> : null}
                    {line.description}
                    {pack.showMoney && line.priceCents != null ? <span className="num ml-2">{formatWhole(line.priceCents)}</span> : null}
                  </p>
                  {line.notes ? <p className="text-sm text-[var(--mac-secondary)]">{line.notes}</p> : null}
                  {!field && line.changed ? <span className="fl-pill">Budget changed</span> : null}
                  {line.files.map((file) => (
                    <a key={file.id} href={`/api/files/${file.documentId}`} className="block text-sm text-[var(--mac-accent)]">
                      {file.filename}
                    </a>
                  ))}
                  {draft ? (
                    <ActionForm action={saveSpecLineAction.bind(null, line.id)} className="mt-2 flex flex-col gap-2">
                      <label className="text-sm">
                        Description
                        <input name="description" aria-label={`Description ${line.description}`} defaultValue={line.description} className="field mt-1" />
                      </label>
                      <label className="text-sm">
                        Cost code
                        <input name="costCode" aria-label={`Cost code ${line.description}`} defaultValue={line.costCode} className="field mt-1" />
                      </label>
                      <label className="text-sm">
                        Group
                        <input name="groupLabel" aria-label={`Group ${line.description}`} defaultValue={line.groupLabel} className="field mt-1" />
                      </label>
                      <label className="text-sm">
                        Notes
                        <input name="notes" aria-label={`Notes ${line.description}`} defaultValue={line.notes} className="field mt-1" />
                      </label>
                      <button type="submit" className="ctl h-9 w-fit" aria-label={`Save ${line.description}`}>
                        Save
                      </button>
                    </ActionForm>
                  ) : null}
                  {draft ? (
                    <div className="mt-2 flex gap-2">
                      <ActionForm action={moveSpecLineAction.bind(null, line.id, "up")}>
                        <button type="submit" className="ctl h-9" aria-label={`Up ${line.description}`}>
                          Up
                        </button>
                      </ActionForm>
                      <ActionForm action={moveSpecLineAction.bind(null, line.id, "down")}>
                        <button type="submit" className="ctl h-9" aria-label={`Down ${line.description}`}>
                          Down
                        </button>
                      </ActionForm>
                    </div>
                  ) : null}
                  {pack.canEdit && pack.latest && line.changed ? (
                    <div className="mt-2 flex gap-2">
                      <ActionForm action={refreshSpecLineAction.bind(null, line.id)}>
                        <button type="submit" className="ctl h-9" aria-label={`Refresh ${line.description}`}>
                          Refresh
                        </button>
                      </ActionForm>
                      <ActionForm action={keepSpecLineAction.bind(null, line.id)}>
                        <button type="submit" className="ctl h-9" aria-label={`Keep ${line.description}`}>
                          Keep
                        </button>
                      </ActionForm>
                    </div>
                  ) : null}
                  {draft ? (
                    <ActionForm action={attachSpecFileAction.bind(null, line.id)} className="mt-2 flex flex-col gap-2">
                      <FileButton name="file" label={`Cut sheet ${line.description}`} accept="image/jpeg,image/png,image/webp,application/pdf" />
                      <button type="submit" className="ctl h-9 w-fit">
                        Attach
                      </button>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {draft ? (
          <ActionForm action={addSpecLineAction.bind(null, pack.id)} className="flex flex-col gap-2">
            <label className="text-sm">
              New line
              <input name="description" aria-label="New line" className="field mt-1" />
            </label>
            <label className="text-sm">
              Cost code
              <input name="costCode" aria-label="New cost code" className="field mt-1" />
            </label>
            <button type="submit" className="ctl h-9 w-fit">
              Add line
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
