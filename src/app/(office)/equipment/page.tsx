import Image from "next/image";
import Link from "next/link";
import { checkInEquipmentAction, checkOutEquipmentAction, reverseEquipmentCostAction, saveEquipmentAction } from "@/app/actions";
import { EquipmentFilters } from "@/components/equipment-filters";
import { FileButton } from "@/components/file-button";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canEditCrm } from "@/lib/permissions";
import { equipmentChoices, equipmentDetail, equipmentQueue, equipmentStatusLabel, listEquipment } from "@/lib/services/equipment";
import { calendarForOrg } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

function officeDay(orgId: string) {
  return localDay(Date.now(), calendarForOrg(orgId).timeZone);
}

function dollars(cents: number | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";
  const status = one(query.status);
  const place = one(query.place);
  const category = one(query.category);
  const rows = listEquipment(session, { status, place, category, due: one(query.due), service: one(query.service), where: one(query.where) });
  const choices = equipmentChoices(session);
  const selectedId = one(query.item);
  const selected = selectedId ? equipmentDetail(session, selectedId) : null;
  const queue = equipmentQueue(session.orgId, officeDay(session.orgId));
  const office = canEditCrm(session.role);
  const showNew = one(query.new) === "1" && office;
  const showEdit = Boolean(selected && one(query.edit) === "1" && selected.canEdit);
  const showOut = Boolean(selected && one(query.out) === "1" && selected.canMove && !["in_service", "lost", "retired"].includes(selected.status));
  const showIn = Boolean(selected && one(query.in) === "1" && selected.canMove && selected.openAssignmentId);
  const keep = new URLSearchParams();
  if (status) keep.set("status", status);
  if (place) keep.set("place", place);
  if (category) keep.set("category", category);
  if (selected) keep.set("item", selected.id);
  const back = `/equipment${keep.toString() ? `?${keep}` : ""}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Equipment"
        subtitle={queue.overdue.count ? `${queue.overdue.count} overdue` : `${rows.length}`}
        search
        primary={office ? "New" : undefined}
        primaryHref={office ? "/equipment?new=1" : undefined}
        trailing={
          <Link href="/equipment/labels" className="ctl">
            Labels
          </Link>
        }
      />
      <EquipmentFilters status={status} place={place} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-w-0 flex-1 overflow-auto px-4">
          {rows.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No equipment</p> : null}
          <table className="mac-table hidden w-full md:table" aria-label="Equipment">
            <thead>
              <tr>
                <th>Name</th>
                <th>Tag</th>
                <th>Status</th>
                <th>Location</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-mac-row={`${row.name} ${row.tag}`} className={row.id === selected?.id ? "is-selected" : undefined}>
                  <td>
                    <Link href={`/equipment?item=${row.id}`}>{row.name}</Link>
                  </td>
                  <td className="num">{row.tag}</td>
                  <td>
                    <span className="fl-pill">{row.statusLabel}</span>
                  </td>
                  <td className="wrap">{row.location}</td>
                  <td className={`num ${row.overdue ? "text-[var(--mac-danger)]" : ""}`}>{row.expectedReturn ? formatCalendarDay(row.expectedReturn) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="fl-group md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/equipment?item=${row.id}`} className="flex items-center gap-2 px-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.name}</span>
                    <span className="block mac-t11 text-[var(--mac-secondary)]">{row.location}</span>
                  </span>
                  <span className="fl-pill">{row.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {selected ? (
          <aside role="complementary" data-detail="equipment" aria-label={selected.name} className="flex w-full shrink-0 flex-col gap-3 border-t border-[var(--mac-separator)] p-4 md:w-[320px] md:border-l md:border-t-0">
            <div className="flex items-center gap-2">
              <h2 className="mac-t15 min-w-0 flex-1">{selected.name}</h2>
              <span className="fl-pill">{selected.statusLabel}</span>
              {selected.canEdit ? (
                <Link href={`/equipment?item=${selected.id}&edit=1`} className="ctl">
                  Edit
                </Link>
              ) : null}
            </div>
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 mac-t13">
              <dt className="text-[var(--mac-secondary)]">Category</dt>
              <dd>{selected.category}</dd>
              {selected.makeModel ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Make</dt>
                  <dd>{selected.makeModel}</dd>
                </>
              ) : null}
              {selected.serial ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Serial</dt>
                  <dd className="num">{selected.serial}</dd>
                </>
              ) : null}
              {selected.tag ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Tag</dt>
                  <dd className="num">{selected.tag}</dd>
                </>
              ) : null}
              {selected.purchasedOn ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Purchased</dt>
                  <dd className="num">{formatCalendarDay(selected.purchasedOn)}</dd>
                </>
              ) : null}
              {selected.showMoney && selected.costCents != null ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Cost</dt>
                  <dd className="num">{formatMoney(selected.costCents)}</dd>
                </>
              ) : null}
              {selected.showMoney && selected.rateCents != null ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Rate</dt>
                  <dd className="num">
                    {formatMoney(selected.rateCents)}/{selected.rateUnit === "hour" ? "h" : "d"}
                  </dd>
                </>
              ) : null}
              <dt className="text-[var(--mac-secondary)]">Location</dt>
              <dd>{selected.location}</dd>
              {selected.expectedReturn ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Return</dt>
                  <dd className={`num ${selected.overdue ? "text-[var(--mac-danger)]" : ""}`}>{formatCalendarDay(selected.expectedReturn)}</dd>
                </>
              ) : null}
              {selected.nextService ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Service</dt>
                  <dd className="num">{formatCalendarDay(selected.nextService)}</dd>
                </>
              ) : null}
              {selected.lastSeen ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Last seen</dt>
                  <dd>
                    {selected.lastSeen}
                    {selected.lastSeenAddress ? <span className="block mac-t11 text-[var(--mac-secondary)]">{selected.lastSeenAddress}</span> : null}
                    {selected.lastSeenAt ? <span className="block num mac-t11 text-[var(--mac-secondary)]">{formatDateTime(selected.lastSeenAt)}</span> : null}
                  </dd>
                </>
              ) : null}
              {selected.notes ? (
                <>
                  <dt className="text-[var(--mac-secondary)]">Notes</dt>
                  <dd>{selected.notes}</dd>
                </>
              ) : null}
            </dl>
            {selected.documentId ? <Image src={`/api/files/${selected.documentId}`} alt="" width={320} height={96} unoptimized className="h-24 w-full rounded-lg object-cover" /> : null}
            {selected.history.length > 0 ? (
              <ul aria-label="History" className="flex flex-col">
                {selected.history.map((row) => (
                  <li key={row.id} className="border-b border-[var(--mac-separator)] py-2 mac-t13">
                    <span className="num mac-t11 text-[var(--mac-secondary)]">{formatDateTime(row.when)}</span>
                    <span className="block">
                      {row.who} · {row.from} → {row.to}
                    </span>
                    {row.returned ? <span className="block mac-t11 text-[var(--mac-secondary)]">In {formatDateTime(row.returned)}</span> : null}
                    {selected.showMoney && row.costState === "posted" && row.costCents ? <span className="num mac-t11">{formatMoney(row.costCents)}</span> : null}
                    {selected.canEdit && row.costState === "posted" && row.costCents ? (
                      <form action={reverseEquipmentCostAction.bind(null, row.id)}>
                        <input type="hidden" name="back" value={back} />
                        <button type="submit" className="ctl">
                          Reverse
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {selected.canMove && selected.status !== "in_service" && selected.status !== "lost" && selected.status !== "retired" ? (
              <div className="flex gap-2">
                <Link href={`/equipment?item=${selected.id}&${selected.openAssignmentId ? "in" : "out"}=1`} className="ctl">
                  {selected.openAssignmentId ? "Check in" : "Check out"}
                </Link>
                {selected.openAssignmentId ? (
                  <Link href={`/equipment?item=${selected.id}&out=1`} className="ctl">
                    Transfer
                  </Link>
                ) : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
      {showNew || showEdit ? (
        <form action={saveEquipmentAction.bind(null, showEdit && selected ? selected.id : "")} data-sheet="equipment" className="fixed inset-y-0 right-0 z-40 flex w-[320px] flex-col gap-2 overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
          <h2 className="mac-t15">{showEdit ? "Edit" : "New"}</h2>
          <label className="mac-t13">
            Name
            <input name="name" aria-label="Name" required defaultValue={selected && showEdit ? selected.name : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Category
            <input name="category" aria-label="Category" required defaultValue={selected && showEdit ? selected.category : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Make
            <input name="makeModel" aria-label="Make" defaultValue={selected && showEdit ? selected.makeModel : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Serial
            <input name="serial" aria-label="Serial" defaultValue={selected && showEdit ? selected.serial : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Tag
            <input name="tag" aria-label="Tag" defaultValue={selected && showEdit ? selected.tag : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Purchased
            <input name="purchasedOn" type="date" aria-label="Purchased" defaultValue={selected && showEdit ? selected.purchasedOn ?? "" : ""} className="field mt-1" />
          </label>
          {session.role !== "field" ? (
            <>
              <label className="mac-t13">
                Cost
                <input name="cost" aria-label="Cost" defaultValue={selected && showEdit ? dollars(selected.costCents) : ""} className="field mt-1" />
              </label>
              <label className="mac-t13">
                Rate
                <input name="rate" aria-label="Rate" defaultValue={selected && showEdit ? dollars(selected.rateCents) : ""} className="field mt-1" />
              </label>
              <label className="mac-t13">
                Per
                <select name="rateUnit" aria-label="Per" defaultValue={selected && showEdit ? selected.rateUnit ?? "" : ""} className="field mt-1">
                  <option value="">No rate</option>
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                </select>
              </label>
            </>
          ) : null}
          <label className="mac-t13">
            Status
            <select name="status" aria-label="Status" defaultValue={selected && showEdit ? selected.status : "available"} className="field mt-1">
              {["available", "in_service", "lost", "retired"].map((item) => (
                <option key={item} value={item}>
                  {equipmentStatusLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="mac-t13">
            Service every
            <input name="serviceInterval" aria-label="Service every" defaultValue={selected && showEdit && selected.serviceInterval ? String(selected.serviceInterval) : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Service unit
            <select name="serviceUnit" aria-label="Service unit" defaultValue={selected && showEdit ? selected.serviceUnit ?? "" : ""} className="field mt-1">
              <option value="">None</option>
              <option value="day">Days</option>
              <option value="hour">Hours</option>
            </select>
          </label>
          <label className="mac-t13">
            Last service
            <input name="lastServiceOn" type="date" aria-label="Last service" defaultValue={selected && showEdit ? selected.lastServiceOn ?? "" : ""} className="field mt-1" />
          </label>
          <label className="mac-t13">
            Notes
            <textarea name="notes" aria-label="Notes" defaultValue={selected && showEdit ? selected.notes : ""} rows={3} className="field mt-1" />
          </label>
          <FileButton name="photo" label="Photo" accept="image/*,.pdf" empty="Photo" />
          <div className="flex gap-2">
            <button type="submit" className="mac-primary">
              Save
            </button>
            <Link href={back} className="ctl">
              Cancel
            </Link>
          </div>
        </form>
      ) : null}
      {showOut && selected ? (
        <form action={checkOutEquipmentAction.bind(null, selected.id)} data-sheet="checkout" className="fixed inset-y-0 right-0 z-40 flex w-[320px] flex-col gap-2 overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
          <h2 className="mac-t15">{selected.openAssignmentId ? "Transfer" : "Check out"}</h2>
          {selected.openAssignmentId ? <input type="hidden" name="transfer" value="1" /> : null}
          <input type="hidden" name="back" value={back} />
          <label className="mac-t13">
            Job
            <select name="projectId" aria-label="Job" className="field mt-1" defaultValue="">
              <option value="">Job</option>
              {choices.jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mac-t13">
            Person
            <select name="userId" aria-label="Person" className="field mt-1" defaultValue="">
              <option value="">Person</option>
              {choices.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mac-t13">
            Return
            <input name="expectedReturn" type="date" aria-label="Return" className="field mt-1" />
          </label>
          {selected.openAssignmentId && selected.rateUnit === "hour" ? <input name="hours" aria-label="Hours" defaultValue="1" className="field" /> : null}
          {selected.openAssignmentId && selected.showMoney && selected.suggestedCents != null ? (
            <label className="mac-t13">
              Cost
              <input name="cost" aria-label="Cost" defaultValue={dollars(selected.suggestedCents)} className="field mt-1" />
            </label>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="mac-primary">
              Save
            </button>
            <Link href={back} className="ctl">
              Cancel
            </Link>
          </div>
        </form>
      ) : null}
      {showIn && selected ? (
        <form action={checkInEquipmentAction.bind(null, selected.id)} data-sheet="checkin" className="fixed inset-y-0 right-0 z-40 flex w-[320px] flex-col gap-2 overflow-auto border-l border-[var(--mac-separator)] bg-[var(--mac-window)] p-4">
          <h2 className="mac-t15">Check in</h2>
          <input type="hidden" name="back" value={back} />
          {selected.rateUnit === "hour" ? (
            <label className="mac-t13">
              Hours
              <input name="hours" aria-label="Hours" defaultValue="1" className="field mt-1" />
            </label>
          ) : null}
          {selected.showMoney && selected.suggestedCents != null ? (
            <label className="mac-t13">
              Cost
              <input name="cost" aria-label="Cost" defaultValue={dollars(selected.suggestedCents)} className="field mt-1" />
            </label>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="mac-primary">
              Save
            </button>
            <Link href={back} className="ctl">
              Cancel
            </Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
