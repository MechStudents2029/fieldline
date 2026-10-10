import Link from "next/link";
import { notFound } from "next/navigation";
import { inspectionTodosAction, reinspectAction, saveInspectionAction, savePermitAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { INSPECTION_RESULTS, PERMIT_STATUSES, PERMIT_TYPES, inspectionResultLabel, permitStatusLabel, permitTypeLabel } from "@/lib/permits/rules";
import { permitBoard } from "@/lib/services/permits";

export const dynamic = "force-dynamic";

export default async function PermitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; inspection?: string; permit?: string; edit?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  const board = permitBoard(session, id);
  if (!board) notFound();
  const selected = board.permits.flatMap((permit) => permit.inspections).find((row) => row.id === query.inspection) ?? null;
  const editing = board.permits.find((permit) => permit.id === query.permit) ?? null;
  const showInspection = query.new === "inspection" && !selected;
  const showNew = !showInspection && !selected && (query.new === "permit" || Boolean(editing));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Permits"
        subtitle={board.projectName}
        search={false}
        center={jobSectionTabs(id, "permits")}
        trailing={
          board.canEdit ? (
            <Link href={`/projects/${id}/permits?new=permit`} className="mac-primary">
              Add
            </Link>
          ) : null
        }
      />
      <div className={`grid gap-6 px-4 pb-8 ${selected || showNew || showInspection ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
        <div className="flex flex-col gap-4">
          {board.permits.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No permits</p> : null}
          {board.permits.map((permit) => (
            <section key={permit.id} className="flex flex-col gap-2" aria-label={permit.number || permit.typeLabel}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="mac-t13">
                    {permit.typeLabel}
                    {permit.number ? ` · ${permit.number}` : ""}
                  </p>
                  <p className="mac-t11 text-[var(--mac-secondary)]">
                    {[permit.jurisdiction, permit.expiresOn ? formatCalendarDay(permit.expiresOn) : "", board.showFee && permit.feeCents ? formatMoney(permit.feeCents) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="fl-pill">{permit.statusLabel}</span>
                {board.canEdit ? (
                  <Link href={`/projects/${id}/permits?permit=${permit.id}`} className="ctl">
                    Edit
                  </Link>
                ) : null}
              </div>
              <ul className="fl-group">
                {permit.inspections.map((row) => (
                  <li key={row.id}>
                    <Link href={`/projects/${id}/permits?inspection=${row.id}`} className="fl-cell fl-press">
                      <span className="min-w-0 flex-1">
                        <span className="fl-body block">
                          {row.name}
                          {row.attempt > 1 ? ` ${row.attempt}` : ""}
                        </span>
                        <span className="fl-footnote block text-[var(--fl-secondary)]">
                          {[row.scheduledOn ? formatCalendarDay(row.scheduledOn) : "", row.gates.map((gate) => gate.title).join(", "), row.files[0]?.name ?? ""].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="fl-pill">{row.resultLabel}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {board.canEdit ? (
                <Link href={`/projects/${id}/permits?new=inspection&permit=${permit.id}`} className="mac-t13 text-[var(--mac-accent)]">
                  Add inspection
                </Link>
              ) : null}
            </section>
          ))}
        </div>
        {selected ? (
          <aside className="flex flex-col gap-3" data-detail="inspection" aria-label={selected.name}>
            <div className="flex items-center gap-2">
              <h2 className="mac-t15 min-w-0 flex-1">
                {selected.name}
                {selected.attempt > 1 ? ` ${selected.attempt}` : ""}
              </h2>
              <span className="fl-pill">{selected.resultLabel}</span>
              {board.canEdit ? (
                <Link href={`/projects/${id}/permits?inspection=${selected.id}&edit=1`} className="ctl">
                  Edit
                </Link>
              ) : null}
            </div>
            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-y-1 mac-t13">
              <dt className="text-[var(--mac-secondary)]">Name</dt>
              <dd>{selected.name}</dd>
              <dt className="text-[var(--mac-secondary)]">Schedule item</dt>
              <dd>{board.schedule.find((item) => item.id === selected.scheduleItemId)?.title ?? ""}</dd>
              <dt className="text-[var(--mac-secondary)]">Date</dt>
              <dd>{selected.scheduledOn ? formatCalendarDay(selected.scheduledOn) : ""}</dd>
              <dt className="text-[var(--mac-secondary)]">Result</dt>
              <dd>
                <span className="fl-pill">{selected.resultLabel}</span>
              </dd>
              <dt className="text-[var(--mac-secondary)]">Gates</dt>
              <dd>{selected.gates.map((gate) => gate.title).join(", ")}</dd>
              <dt className="text-[var(--mac-secondary)]">File</dt>
              <dd>{selected.files.map((file) => file.name).join(", ")}</dd>
            </dl>
            {selected.todos.length > 0 ? (
              <ul className="fl-group" aria-label="To-dos">
                {selected.todos.map((todo) => (
                  <li key={todo.id} className="fl-cell mac-t13">
                    {todo.title}
                  </li>
                ))}
              </ul>
            ) : selected.notes ? (
              <p className="mac-t13 whitespace-pre-line">{selected.notes}</p>
            ) : null}
            {board.canEdit && (selected.result === "failed" || selected.result === "partial") ? (
              <div className="flex gap-2">
                <ActionForm action={inspectionTodosAction.bind(null, id, selected.id)}>
                  <button type="submit" className="ctl">
                    To-dos
                  </button>
                </ActionForm>
                <ActionForm action={reinspectAction.bind(null, id, selected.id)}>
                  <button type="submit" className="ctl">
                    Request re-inspection
                  </button>
                </ActionForm>
              </div>
            ) : null}
          </aside>
        ) : null}
        {selected && query.edit === "1" && board.canEdit ? (
          <div className="fixed inset-y-0 right-0 z-40 w-[320px] overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
            <InspectionForm
              projectId={id}
              permitId={board.permits.find((permit) => permit.inspections.some((row) => row.id === selected.id))?.id ?? ""}
              board={board}
              inspection={selected}
              cancelHref={`/projects/${id}/permits?inspection=${selected.id}`}
            />
          </div>
        ) : null}
        {showNew && board.canEdit ? <PermitForm projectId={id} board={board} permit={editing} /> : null}
        {showInspection && board.canEdit ? <InspectionForm projectId={id} permitId={query.permit ?? board.permits[0]?.id ?? ""} board={board} inspection={null} /> : null}
      </div>
    </div>
  );
}

function PermitForm({
  projectId,
  board,
  permit,
}: {
  projectId: string;
  board: NonNullable<ReturnType<typeof permitBoard>>;
  permit: NonNullable<ReturnType<typeof permitBoard>>["permits"][number] | null;
}) {
  return (
    <ActionForm action={savePermitAction.bind(null, projectId)} dataSheet="permit" className="flex flex-col gap-2">
      <h2 className="mac-t15">{permit ? "Permit" : "New permit"}</h2>
      {permit ? <input type="hidden" name="permitId" value={permit.id} /> : null}
      <label className="text-[13px]">
        Type
        <select name="permitType" aria-label="Type" defaultValue={permit?.permitType ?? "building"} className="field mt-1">
          {PERMIT_TYPES.map((type) => (
            <option key={type} value={type}>
              {permitTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px]">
        Number
        <input name="number" aria-label="Number" defaultValue={permit?.number ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Jurisdiction
        <input name="jurisdiction" aria-label="Jurisdiction" defaultValue={permit?.jurisdiction ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Status
        <select name="status" aria-label="Status" defaultValue={permit?.status ?? "not_applied"} className="field mt-1">
          {PERMIT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {permitStatusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px]">
        Applied
        <input name="appliedOn" type="date" aria-label="Applied" defaultValue={permit?.appliedOn ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Issued
        <input name="issuedOn" type="date" aria-label="Issued" defaultValue={permit?.issuedOn ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Expires
        <input name="expiresOn" type="date" aria-label="Expires" defaultValue={permit?.expiresOn ?? ""} className="field mt-1" />
      </label>
      {board.showFee && !permit?.posted ? (
        <>
          <label className="text-[13px]">
            Fee
            <input name="fee" aria-label="Fee" defaultValue={permit?.feeCents ? (permit.feeCents / 100).toFixed(2) : ""} className="field mt-1" />
          </label>
          <label className="text-[13px]">
            Cost code
            <input name="costCode" aria-label="Cost code" defaultValue={permit?.costCode ?? ""} className="field mt-1" />
          </label>
        </>
      ) : null}
      {board.showFee && permit?.posted && permit.feeCents ? <p className="num mac-t13">{formatMoney(permit.feeCents)}</p> : null}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="showPassed" value="1" defaultChecked={permit?.showPassed ?? false} />
        Show passed inspections
      </label>
      {board.files.length > 0 ? (
        <label className="text-[13px]">
          File
          <select name="fileId" aria-label="File" defaultValue="" className="field mt-1">
            <option value="">File</option>
            {board.files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="submit" className="mac-primary w-fit">
        Save
      </button>
    </ActionForm>
  );
}

function InspectionForm({
  projectId,
  permitId,
  board,
  inspection,
  cancelHref,
}: {
  projectId: string;
  permitId: string;
  board: NonNullable<ReturnType<typeof permitBoard>>;
  inspection: NonNullable<ReturnType<typeof permitBoard>>["permits"][number]["inspections"][number] | null;
  cancelHref?: string;
}) {
  const gated = new Set(inspection?.gates.map((gate) => gate.id) ?? []);
  return (
    <ActionForm action={saveInspectionAction.bind(null, projectId)} dataSheet="inspection" className="flex flex-col gap-2">
      <h2 className="mac-t15">{inspection ? "Result" : "New inspection"}</h2>
      {inspection ? <input type="hidden" name="inspectionId" value={inspection.id} /> : null}
      <input type="hidden" name="permitId" value={permitId} />
      <label className="text-[13px]">
        Name
        <input name="name" aria-label="Name" defaultValue={inspection?.name ?? ""} required className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Schedule item
        <select name="scheduleItemId" aria-label="Schedule item" defaultValue={inspection?.scheduleItemId ?? ""} className="field mt-1">
          <option value="">Schedule item</option>
          {board.schedule.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px]">
        Requested
        <input name="requestedOn" type="date" aria-label="Requested" defaultValue={inspection?.requestedOn ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Scheduled
        <input name="scheduledOn" type="date" aria-label="Scheduled" defaultValue={inspection?.scheduledOn ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Inspector
        <input name="inspector" aria-label="Inspector" defaultValue={inspection?.inspector ?? ""} className="field mt-1" />
      </label>
      <label className="text-[13px]">
        Result
        <select name="result" aria-label="Result" defaultValue={inspection?.result ?? "pending"} className="field mt-1">
          {INSPECTION_RESULTS.map((result) => (
            <option key={result} value={result}>
              {inspectionResultLabel(result)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px]">
        Notes
        <textarea name="notes" aria-label="Notes" defaultValue={inspection?.notes ?? ""} rows={3} className="field mt-1" />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[13px]">Gates</legend>
        {board.schedule.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="gate" value={item.id} defaultChecked={gated.has(item.id)} />
            {item.title}
          </label>
        ))}
      </fieldset>
      {board.files.length > 0 ? (
        <label className="text-[13px]">
          File
          <select name="fileId" aria-label="Photo" defaultValue="" className="field mt-1">
            <option value="">Photo</option>
            {board.files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className="mac-primary w-fit">
          Save
        </button>
        {cancelHref ? (
          <Link href={cancelHref} className="ctl">
            Cancel
          </Link>
        ) : null}
      </div>
    </ActionForm>
  );
}
