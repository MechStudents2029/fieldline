import Link from "next/link";
import { saveCapacityAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { capacityForm } from "@/lib/services/workload";
import { WEEKDAY_NAMES } from "@/lib/time/calendar";

export default async function CapacitySettingsPage() {
  const session = await requireSession();
  if (!canManageSettings(session.role)) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6">
        <h1 className="fl-large-title">Capacity</h1>
        <p className="text-sm text-muted-foreground">Only an owner or admin can change these.</p>
      </div>
    );
  }
  const form = capacityForm(session);
  if (!form) return null;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Capacity" search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Capacity</h1>
        <ActionForm action={saveCapacityAction} className="flex max-w-md flex-col gap-3">
          <label className="text-sm">
            Weekly hours
            <input name="weeklyHours" aria-label="Weekly hours" inputMode="decimal" required defaultValue={form.hours} className="ctl mt-1 w-24" />
          </label>
          <fieldset>
            <legend className="text-sm">Workdays</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, index) => (
                <label key={name} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="workday" value={index} defaultChecked={(form.workdaysMask & (1 << index)) !== 0} />
                  {name.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm">Person</legend>
            <ul className="mt-1 flex flex-col gap-1">
              {form.people.map((person) => (
                <li key={person.id} className="flex items-center gap-2">
                  <input type="hidden" name="person" value={person.id} />
                  <span className="w-36 truncate text-sm">
                    {person.name}
                    <span className="block text-xs text-muted-foreground">{person.role}</span>
                  </span>
                  <input
                    name={`hours_${person.id}`}
                    aria-label={`Hours for ${person.name}`}
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={person.hours}
                    className="ctl w-16"
                  />
                </li>
              ))}
            </ul>
          </fieldset>
          <button type="submit" className="ctl w-fit">
            Save
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
