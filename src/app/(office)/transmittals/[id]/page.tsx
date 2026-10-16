import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addFileAction,
  addNoteAction,
  closeTransmittalAction,
  markSentAction,
  moveLineAction,
  removeLineAction,
  saveTransmittalAction,
  setReturnAction,
  voidTransmittalAction,
} from "@/app/(office)/transmittals/actions";
import { ActionForm } from "@/components/action-form";
import { CopyTransmittalLink } from "@/components/copy-transmittal";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { TRANSMITTAL_PURPOSES, transmittalDetail, transmittalOptions } from "@/lib/services/transmittals";

export default async function TransmittalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const pack = transmittalDetail(session, id);
  if (!pack) notFound();
  const options = transmittalOptions(session, pack.projectId);
  const toValue = `${pack.toKind}:${pack.toId}`;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={pack.subject} subtitle={String(pack.number)} search={false} leading={<Link href={`/projects/${pack.projectId}/transmittals`}>‹</Link>} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4" data-share={pack.shareUrl}>
        <h1 className="fl-large-title md:hidden">{pack.subject}</h1>
        <p className="text-sm">
          <span className="num">{pack.number}</span>
          <span className="mx-2">{pack.job}</span>
          <span className="fl-pill" data-status={pack.status}>
            {pack.statusLabel}
          </span>
        </p>
        <p className="text-sm">
          {pack.toName}
          {pack.cc.length > 0 ? ` · ${pack.cc.map((row) => row.name).join(", ")}` : ""}
          {pack.dueOn ? ` · ${pack.dueOn}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {pack.canCopy ? <CopyTransmittalLink transmittalId={pack.id} url={pack.shareUrl} /> : null}
          {pack.canSend ? (
            <ActionForm action={markSentAction.bind(null, pack.id)}>
              <Button type="submit">Mark sent</Button>
            </ActionForm>
          ) : null}
          {pack.canClose ? (
            <ActionForm action={closeTransmittalAction.bind(null, pack.id)}>
              <button type="submit" className="mac-glass-btn">
                Close
              </button>
            </ActionForm>
          ) : null}
          <Link href={`/transmittals/${pack.id}/print`} className="text-[var(--mac-accent)]">
            Print
          </Link>
        </div>
        {pack.canEdit && options ? (
          <ActionForm action={saveTransmittalAction.bind(null, pack.id)} className="flex flex-col gap-2">
            <label className="text-sm">
              Subject
              <input name="subject" aria-label="Subject" defaultValue={pack.subject} className="field mt-1" />
            </label>
            <label className="text-sm">
              To
              <select name="to" aria-label="To" defaultValue={toValue} className="field mt-1">
                {options.recipients.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Purpose
              <select name="purpose" aria-label="Purpose" defaultValue={pack.purpose} className="field mt-1">
                {TRANSMITTAL_PURPOSES.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Due
              <input name="dueOn" aria-label="Due" type="date" defaultValue={pack.dueOn} className="field mt-1" />
            </label>
            <label className="text-sm">
              CC
              <select name="cc" aria-label="CC" multiple defaultValue={pack.cc.map((row) => row.userId)} className="field mt-1">
                {options.teammates.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Save</Button>
          </ActionForm>
        ) : (
          <p className="text-sm">{pack.purposeLabel}</p>
        )}
        <table aria-label="Contents" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 font-medium">Return</th>
            </tr>
          </thead>
          <tbody>
            {pack.lines.map((line, index) => (
              <tr key={line.id} className="border-t border-[var(--mac-separator)]" data-line={line.title}>
                <td className="py-2 pr-3 num">{index + 1}</td>
                <td className="py-2 pr-3">{line.title}</td>
                <td className="py-2">
                  {pack.canEdit ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <ActionForm action={setReturnAction.bind(null, line.id, line.returnRequired ? "0" : "1")}>
                        <button type="submit" className="num">
                          {line.returnRequired ? "1" : "0"}
                        </button>
                      </ActionForm>
                      <ActionForm action={moveLineAction.bind(null, line.id, "up")}>
                        <button type="submit" className="mac-glass-btn">
                          Up
                        </button>
                      </ActionForm>
                      <ActionForm action={moveLineAction.bind(null, line.id, "down")}>
                        <button type="submit" className="mac-glass-btn">
                          Down
                        </button>
                      </ActionForm>
                      <ActionForm action={removeLineAction.bind(null, line.id)}>
                        <button type="submit" className="mac-glass-btn">
                          Remove
                        </button>
                      </ActionForm>
                    </span>
                  ) : (
                    <span className="num">{line.returnRequired ? "1" : "0"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pack.canEdit && options ? (
          <div className="flex flex-col gap-3">
            <ActionForm action={addNoteAction.bind(null, pack.id)} className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                Note
                <input name="title" aria-label="Note" className="field mt-1" />
              </label>
              <label className="text-sm">
                <input name="returnRequired" type="checkbox" /> Return
              </label>
              <button type="submit" className="mac-glass-btn">
                Add line
              </button>
            </ActionForm>
            <ActionForm action={addFileAction.bind(null, pack.id)} className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                Attach
                <select name="source" aria-label="Attach" className="field mt-1" defaultValue="">
                  <option value="">Select</option>
                  {options.attachments.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <input name="returnRequired" type="checkbox" /> Return
              </label>
              <button type="submit" className="mac-glass-btn">
                Attach
              </button>
            </ActionForm>
          </div>
        ) : null}
        {pack.ackName ? (
          <table aria-label="Acknowledgment" className="w-full text-left text-sm">
            <tbody>
              <tr data-ack={pack.ackName}>
                <td className="py-2 pr-3">{pack.ackName}</td>
                <td className="py-2 pr-3 num">{pack.ackAt}</td>
                <td className="py-2">{pack.ackNote}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
        {pack.declineReason ? <p data-decline={pack.declineReason}>{pack.declineReason}</p> : null}
        {pack.voidReason ? <p>{pack.voidReason}</p> : null}
        {pack.canVoid ? (
          <ActionForm action={voidTransmittalAction.bind(null, pack.id)} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Reason
              <input name="reason" aria-label="Void reason" className="field mt-1" />
            </label>
            <button type="submit" className="mac-glass-btn">
              Void
            </button>
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
