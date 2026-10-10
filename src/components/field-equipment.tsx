import { checkInEquipmentAction, checkOutEquipmentAction } from "@/app/actions";
import { fieldEquipment } from "@/lib/services/equipment";
import type { Actor } from "@/lib/services/read";

export function FieldEquipment({ actor }: { actor: Actor }) {
  const board = fieldEquipment(actor);
  if (board.mine.length === 0 && board.available.length === 0) return null;
  return (
    <section className="mb-3 px-4" aria-label="Equipment">
      <h2 className="mb-1 mac-t11 font-semibold text-[var(--mac-secondary)]">Equipment</h2>
      <ul>
        {board.mine.map((item) => (
          <li key={item.id} className="flex items-center gap-2 border-b border-[var(--mac-separator)] py-1">
            <span className="min-w-0 flex-1 truncate mac-t13">{item.name}</span>
            <span className="fl-pill">{item.statusLabel}</span>
            <form action={checkInEquipmentAction.bind(null, item.id)}>
              <input type="hidden" name="back" value="/todos" />
              <input type="hidden" name="hours" value="1" />
              <button type="submit" className="ctl">
                Check in
              </button>
            </form>
          </li>
        ))}
      </ul>
      {board.available.length > 0 ? (
        <form action={checkOutEquipmentAction.bind(null, "")} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="back" value="/todos" />
          <input type="hidden" name="userId" value={actor.userId} />
          <select name="equipmentId" aria-label="Equipment" className="ctl" defaultValue={board.available[0]?.id}>
            {board.available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select name="projectId" aria-label="Job" className="ctl" defaultValue="">
            <option value="">Job</option>
            {board.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
          <button type="submit" className="ctl">
            Check out
          </button>
        </form>
      ) : null}
    </section>
  );
}
