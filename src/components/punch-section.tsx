import {
  addPunchAction,
  closeJobAction,
  declineWarrantyAction,
  markPunchDoneAction,
  markSubstantialAction,
  reopenJobAction,
  resolveWarrantyAction,
  scheduleWarrantyAction,
  setPunchSharedAction,
  verifyPunchAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyField } from "@/components/copy-field";
import { formatCalendarDay, formatWarrantyDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { PunchBoard } from "@/lib/services/punch";

function Pill({ children }: { children: string }) {
  return <span className="fl-pill">{children}</span>;
}

export function PunchSection({ board }: { board: PunchBoard }) {
  const { counts, closeout } = board;
  return (
    <section id="punch" aria-label="Punch list" data-today={board.today} className="mb-6">
      <div className="mac-strip mb-4">
        <div>
          <p className="mac-t22 num" data-count="open">
            {counts.open}
          </p>
          <p className="mac-t11 text-[var(--mac-secondary)]">Open</p>
        </div>
        <div>
          <p className="mac-t22 num" data-count="done">
            {counts.done}
          </p>
          <p className="mac-t11 text-[var(--mac-secondary)]">Done</p>
        </div>
        <div>
          <p className="mac-t22 num" data-count="verified">
            {counts.verified}
          </p>
          <p className="mac-t11 text-[var(--mac-secondary)]">Verified</p>
        </div>
      </div>
      <ul className="mb-4 flex flex-col">
        {board.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--mac-separator)] py-2">
            <div className="min-w-0 flex-1">
              <p className="mac-t13 font-semibold">{item.title}</p>
              <p className="mac-t11 text-[var(--mac-secondary)]">
                {[item.location, item.assigneeName, item.dueDate ? formatCalendarDay(item.dueDate) : "", board.showMoney ? item.costCode : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Pill>{item.statusLabel}</Pill>
            {item.shared ? <Pill>Shared</Pill> : null}
            {board.canEdit && item.status !== "verified" ? (
              <ActionForm action={verifyPunchAction.bind(null, item.id)}>
                <button type="submit" className="text-sm text-[var(--fl-accent)]">
                  Verify {item.title}
                </button>
              </ActionForm>
            ) : null}
            {board.canEdit ? (
              <ActionForm action={setPunchSharedAction.bind(null, item.id, item.shared ? "0" : "1")}>
                <button type="submit" className="text-sm text-[var(--mac-secondary)]">
                  {item.shared ? `Hide ${item.title}` : `Share ${item.title}`}
                </button>
              </ActionForm>
            ) : null}
            {board.canAdd && item.status !== "verified" ? (
              <ActionForm action={markPunchDoneAction.bind(null, item.id)} className="flex items-center gap-2">
                <label className="text-sm">
                  After
                  <input className="ml-1 text-sm" type="file" name="photo" accept="image/jpeg,image/png,image/webp" aria-label={`After photo ${item.title}`} />
                </label>
                <button type="submit" className="text-sm text-[var(--fl-accent)]">
                  Mark {item.title} done
                </button>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      {board.canEdit ? (
        <ActionForm action={addPunchAction.bind(null, board.projectId)} className="mb-6 grid gap-2 md:grid-cols-2">
          <label className="text-sm">
            Item
            <input name="title" className="field mt-1" />
          </label>
          <label className="text-sm">
            Room
            <input name="location" className="field mt-1" />
          </label>
          <label className="text-sm">
            Due
            <input name="due" type="date" className="field mt-1" />
          </label>
          <label className="text-sm">
            Crew
            <select name="assigneeUser" className="field mt-1" defaultValue="">
              <option value="">—</option>
              {board.crew.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Vendor
            <select name="assigneeContact" className="field mt-1" defaultValue="">
              <option value="">—</option>
              {board.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
          {board.showMoney ? (
            <label className="text-sm">
              Cost code
              <select name="costCode" className="field mt-1" defaultValue="">
                <option value="">—</option>
                {board.codes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="shared" />
            Share
          </label>
          <label className="text-sm">
            Before
            <input className="mt-1 block text-sm" type="file" name="photo" accept="image/jpeg,image/png,image/webp" aria-label="Before photo" />
          </label>
          <button type="submit" className="mac-primary h-9">
            Add punch
          </button>
        </ActionForm>
      ) : null}
      {board.canEdit || board.showMoney ? (
      <div id="closeout" className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Closeout</p>
          {closeout.substantial ? <Pill>Substantial</Pill> : null}
          {closeout.closed ? <Pill>Closed</Pill> : null}
          {closeout.endsOn ? <span className="mac-t11 num text-[var(--mac-secondary)]">{formatWarrantyDay(closeout.endsOn)}</span> : null}
        </div>
        <dl className="mac-kv" aria-label="Closeout">
          {closeout.checklist.map((row) => (
            <div key={row.key} data-blocker={row.key}>
              <dt>{row.label}</dt>
              <dd className="num">{row.count}</dd>
            </div>
          ))}
        </dl>
        {board.canEdit && !closeout.substantial ? (
          <ActionForm action={markSubstantialAction.bind(null, board.projectId)} className="mt-3">
            <button type="submit" className="mac-primary h-9">
              Substantial
            </button>
          </ActionForm>
        ) : null}
        {board.canEdit && closeout.substantial && !closeout.closed ? (
          <ActionForm action={closeJobAction.bind(null, board.projectId)} className="mt-3 grid gap-2 md:grid-cols-2">
            <label className="text-sm">
              Warranty months
              <input name="months" type="number" min={1} max={120} defaultValue={closeout.months} className="field mt-1" />
            </label>
            <label className="text-sm">
              Reason
              <input name="reason" className="field mt-1" />
            </label>
            <button type="submit" className="mac-primary h-9">
              Close job
            </button>
          </ActionForm>
        ) : null}
        {board.canEdit && closeout.closed ? (
          <ActionForm action={reopenJobAction.bind(null, board.projectId)} className="mt-3">
            <button type="submit" className="text-sm text-[var(--mac-secondary)]">
              Reopen
            </button>
          </ActionForm>
        ) : null}
      </div>
      ) : null}
      {(board.canEdit || board.showMoney) && (closeout.closed || board.warranty.length > 0) ? (
        <div id="warranty" className="mb-6">
          <p className="mb-2 mac-t11 font-semibold text-[var(--mac-secondary)]">Warranty</p>
          <ul className="flex flex-col gap-4">
            {board.warranty.map((request) => (
              <li key={request.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mac-t13 font-semibold">{request.title}</p>
                  <Pill>{request.statusLabel}</Pill>
                  <span className="mac-t11 text-[var(--mac-secondary)]">{request.urgencyLabel}</span>
                </div>
                {request.description ? <p className="mac-t13">{request.description}</p> : null}
                {request.clientNote ? <p className="mac-t13">{request.clientNote}</p> : null}
                {request.visitNote ? <CopyField label={`Visit note ${request.title}`} value={request.visitNote} /> : null}
                {board.showMoney && request.amountCents != null ? (
                  <p className="mac-t11 num text-[var(--mac-secondary)]">
                    {request.costCode} · {formatMoney(request.amountCents)}
                  </p>
                ) : null}
                {board.canEdit && request.internalNote ? <p className="mac-t11 text-[var(--mac-secondary)]">{request.internalNote}</p> : null}
                {board.canEdit && request.status !== "resolved" && request.status !== "declined" ? (
                  <>
                    <ActionForm action={scheduleWarrantyAction.bind(null, request.id)} className="grid gap-2 md:grid-cols-3">
                      <label className="text-sm">
                        Assign
                        <select name="assignee" className="field mt-1" defaultValue={request.assigneeUserId ?? ""}>
                          <option value="">—</option>
                          {board.crew.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        Visit
                        <input name="visit" type="date" defaultValue={request.visitDate ?? board.today} className="field mt-1" />
                      </label>
                      <button type="submit" className="mac-primary h-9 self-end">
                        Schedule {request.title}
                      </button>
                    </ActionForm>
                    <ActionForm action={resolveWarrantyAction.bind(null, request.id)} className="grid gap-2 md:grid-cols-2">
                      <label className="text-sm">
                        Note
                        <input name="note" className="field mt-1" aria-label={`Note ${request.title}`} />
                      </label>
                      <label className="text-sm">
                        Internal
                        <input name="internal" className="field mt-1" aria-label={`Internal ${request.title}`} />
                      </label>
                      {board.showMoney ? (
                        <>
                          <label className="text-sm">
                            Cost code
                            <select name="costCode" className="field mt-1" defaultValue="">
                              <option value="">—</option>
                              {board.codes.map((code) => (
                                <option key={code} value={code}>
                                  {code}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm">
                            Amount
                            <input name="amount" inputMode="decimal" className="field mt-1" aria-label={`Amount ${request.title}`} />
                          </label>
                        </>
                      ) : null}
                      <button type="submit" className="mac-primary h-9">
                        Resolve {request.title}
                      </button>
                    </ActionForm>
                    <ActionForm action={declineWarrantyAction.bind(null, request.id)} className="grid gap-2 md:grid-cols-2">
                      <label className="text-sm">
                        Note
                        <input name="note" className="field mt-1" aria-label={`Decline note ${request.title}`} />
                      </label>
                      <button type="submit" className="text-sm text-[var(--mac-secondary)]">
                        Decline {request.title}
                      </button>
                    </ActionForm>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
