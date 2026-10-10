import { checkInEquipmentAction, checkOutEquipmentAction } from "@/app/actions";
import { formatCalendarDay } from "@/lib/format";
import { equipmentChoices, equipmentDetail, jobEquipment } from "@/lib/services/equipment";
import type { Actor } from "@/lib/services/read";

export function JobEquipment({ actor, projectId }: { actor: Actor; projectId: string }) {
  const board = jobEquipment(actor, projectId);
  if (board.onJob.length === 0 && board.available.length === 0) return null;
  const choices = equipmentChoices(actor);
  const back = `/projects/${projectId}`;
  return (
    <section className="mb-6" aria-label="Equipment">
      <h2 className="mb-2 mac-t13 font-semibold text-[var(--mac-secondary)]">Equipment</h2>
      <ul className="mb-2 flex flex-col">
        {board.onJob.map((item) => {
          const detail = equipmentDetail(actor, item.id);
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--mac-separator)] py-2">
              <a href={`/equipment?item=${item.id}`} className="min-w-0 flex-1 mac-t13">
                {item.name}
                <span className="block mac-t11 text-[var(--mac-secondary)]">{item.location}</span>
              </a>
              {item.expectedReturn ? <span className={`num mac-t11 ${item.overdue ? "text-[var(--mac-danger)]" : "text-[var(--mac-secondary)]"}`}>{formatCalendarDay(item.expectedReturn)}</span> : null}
              <span className="fl-pill">{item.statusLabel}</span>
              {board.canMove && detail?.openAssignmentId ? (
                <form action={checkInEquipmentAction.bind(null, item.id)} className="flex items-center gap-1">
                  <input type="hidden" name="back" value={back} />
                  {detail.rateUnit === "hour" ? <input name="hours" aria-label={`Hours ${item.name}`} defaultValue="1" className="ctl w-14" /> : null}
                  {board.showMoney && detail.suggestedCents != null ? (
                    <input name="cost" aria-label={`Cost ${item.name}`} defaultValue={(detail.suggestedCents / 100).toFixed(2)} className="ctl w-20" />
                  ) : null}
                  <button type="submit" className="ctl">
                    Check in
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {board.canMove && board.available.length > 0 ? (
        <form action={checkOutEquipmentAction.bind(null, "")} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="projectId" value={projectId} />
          <select name="equipmentId" aria-label="Equipment" className="ctl" defaultValue={board.available[0]?.id}>
            {board.available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select name="userId" aria-label="Person" className="ctl" defaultValue="">
            <option value="">Person</option>
            {choices.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <input name="expectedReturn" type="date" aria-label="Return" className="ctl" />
          <button type="submit" className="ctl">
            Check out
          </button>
        </form>
      ) : null}
    </section>
  );
}
