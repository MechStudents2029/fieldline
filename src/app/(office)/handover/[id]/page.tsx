import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addItemAction,
  addSectionAction,
  attachDocAction,
  markDeliveredAction,
  markReadyAction,
  moveItemAction,
  moveSectionAction,
  publishHandoverAction,
  removeItemAction,
  removeSectionAction,
  saveItemAction,
} from "@/app/(office)/handover/actions";
import { ActionForm } from "@/components/action-form";
import { CopyHandoverLink } from "@/components/copy-handover";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { handoverDetail } from "@/lib/services/handover";

export default async function HandoverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const pack = handoverDetail(session, id);
  if (!pack) notFound();
  const office = canEditCrm(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={pack.job} subtitle={String(pack.readiness)} search={false} leading={<Link href="/handover">‹</Link>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">{pack.job}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="fl-pill" data-status={pack.status}>
            {pack.statusLabel}
          </span>
          <span className="num" data-readiness={pack.readiness}>
            {pack.readiness}
          </span>
          <Link href={`/projects/${pack.projectId}`} className="text-[var(--mac-accent)]">
            {pack.job}
          </Link>
          <Link href={`/handover/${pack.id}/print`} className="text-[var(--mac-accent)]">
            Print
          </Link>
          {office ? <CopyHandoverLink packageId={pack.id} url={pack.shareUrl} /> : null}
        </div>
        {office ? (
          <div className="flex flex-wrap gap-2">
            {pack.status === "draft" ? (
              <ActionForm action={markReadyAction.bind(null, pack.id)}>
                <Button type="submit">Ready</Button>
              </ActionForm>
            ) : null}
            {pack.status !== "draft" && !pack.published ? (
              <ActionForm action={publishHandoverAction.bind(null, pack.id)}>
                <Button type="submit">Publish</Button>
              </ActionForm>
            ) : null}
            {pack.status !== "delivered" && pack.status !== "draft" ? (
              <ActionForm action={markDeliveredAction.bind(null, pack.id)}>
                <button type="submit" className="mac-glass-btn">
                  Mark delivered
                </button>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
        {pack.sections.map((section) => (
          <section key={section.id} data-section={section.kind} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              {office ? (
                <>
                  <ActionForm action={moveSectionAction.bind(null, section.id, "up")}>
                    <button type="submit" className="mac-glass-btn" aria-label={`Up ${section.title}`}>
                      Up
                    </button>
                  </ActionForm>
                  <ActionForm action={moveSectionAction.bind(null, section.id, "down")}>
                    <button type="submit" className="mac-glass-btn" aria-label={`Down ${section.title}`}>
                      Down
                    </button>
                  </ActionForm>
                  <ActionForm action={removeSectionAction.bind(null, section.id)}>
                    <button type="submit" className="mac-glass-btn" aria-label={`Remove ${section.title}`}>
                      Remove
                    </button>
                  </ActionForm>
                </>
              ) : null}
            </div>
            {section.items.map((item) => (
              <article key={item.id} data-item={item.title} className="flex flex-col gap-2 border-t border-[var(--mac-separator)] py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.title}</p>
                  {item.missing ? <span className="fl-pill">Missing doc</span> : null}
                  {item.model ? <span className="text-[var(--mac-secondary)]">{item.model}</span> : null}
                  {item.finish ? <span className="text-[var(--mac-secondary)]">{item.finish}</span> : null}
                  {item.vendorName ? <span>{item.vendorName}</span> : null}
                  {item.trade ? <span className="fl-pill">{item.trade}</span> : null}
                  {item.phone ? <span className="num">{item.phone}</span> : null}
                  {item.warrantyEndsOn ? <span className="num">{item.warrantyEndsOn}</span> : null}
                  {item.nextDueOn ? <span className="num">{item.nextDueOn}</span> : null}
                  {item.documentName ? <span>{item.documentName}</span> : null}
                </div>
                {office && section.kind === "installed" ? (
                  <ActionForm action={saveItemAction.bind(null, item.id)} className="flex flex-wrap items-end gap-2">
                    <input name="title" aria-label={`Title ${item.title}`} defaultValue={item.title} className="field w-40" />
                    <input name="manufacturer" aria-label={`Manufacturer ${item.title}`} defaultValue={item.manufacturer} className="field w-32" />
                    <input name="model" aria-label={`Model ${item.title}`} defaultValue={item.model} className="field w-32" />
                    <input name="serial" aria-label={`Serial ${item.title}`} defaultValue={item.serial} className="field w-28" />
                    <input type="date" name="installOn" aria-label={`Install ${item.title}`} defaultValue={item.installOn} className="field w-auto" />
                    <input name="warrantyMonths" aria-label={`Warranty ${item.title}`} defaultValue={item.warrantyMonths ?? ""} className="field w-20" />
                    <input name="intervalDays" aria-label={`Interval ${item.title}`} defaultValue={item.intervalDays ?? ""} className="field w-20" />
                    <input name="intervalLabel" aria-label={`Care ${item.title}`} defaultValue={item.intervalLabel} className="field w-32" />
                    <Button type="submit">Save</Button>
                  </ActionForm>
                ) : null}
                {office && section.kind === "installed" ? (
                  <ActionForm action={attachDocAction.bind(null, item.id)} className="flex flex-wrap items-end gap-2">
                    <select name="documentId" aria-label={`Manual ${item.title}`} defaultValue={item.documentId ?? ""} className="field w-auto">
                      <option value="">Manual</option>
                      {pack.documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.filename}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="mac-glass-btn">
                      Attach
                    </button>
                  </ActionForm>
                ) : null}
                {office ? (
                  <div className="flex gap-2">
                    <ActionForm action={moveItemAction.bind(null, item.id, "up")}>
                      <button type="submit" className="mac-glass-btn" aria-label={`Up ${item.title}`}>
                        Up
                      </button>
                    </ActionForm>
                    <ActionForm action={moveItemAction.bind(null, item.id, "down")}>
                      <button type="submit" className="mac-glass-btn" aria-label={`Down ${item.title}`}>
                        Down
                      </button>
                    </ActionForm>
                    <ActionForm action={removeItemAction.bind(null, item.id)}>
                      <button type="submit" className="mac-glass-btn" aria-label={`Remove ${item.title}`}>
                        Remove
                      </button>
                    </ActionForm>
                  </div>
                ) : null}
              </article>
            ))}
            {office ? (
              <ActionForm action={addItemAction.bind(null, section.id)} className="flex flex-wrap items-end gap-2">
                <input name="title" aria-label="Title" className="field w-48" />
                <Button type="submit">Add item</Button>
              </ActionForm>
            ) : null}
          </section>
        ))}
        {office ? (
          <ActionForm action={addSectionAction.bind(null, pack.id)} className="flex flex-wrap items-end gap-2">
            <input name="title" aria-label="Section" className="field w-48" />
            <button type="submit" className="mac-glass-btn">
              Add section
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
