import Link from "next/link";
import { geoSettingsAction, overtimeSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { geoBoard } from "@/lib/services/geo";
import { overtimeBoard } from "@/lib/time/post";
import { WEEKDAY_NAMES } from "@/lib/time/calendar";

function hours(minutes: number | null) {
  if (minutes == null) return "";
  const value = minutes / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function percent(bps: number | null | undefined) {
  if (bps == null) return "";
  const value = bps / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export default async function TimeSettingsPage() {
  const session = await requireSession();
  if (!canManageSettings(session.role)) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6">
        <h1 className="fl-large-title">Time</h1>
        <p className="text-sm text-muted-foreground">Only an owner or admin can change these.</p>
      </div>
    );
  }
  const board = overtimeBoard(session);
  const geo = geoBoard(session);
  if (!board || !geo) return null;
  const { rules, people } = board;
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Time" search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Time</h1>
        <ActionForm action={overtimeSettingsAction} className="flex max-w-md flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={rules.enabled} />
            Overtime
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Daily OT after
              <input name="dailyHours" aria-label="Daily overtime hours" inputMode="decimal" defaultValue={hours(rules.dailyOtMinutes)} className="ctl mt-1 w-24" />
            </label>
            <label className="text-sm">
              Weekly OT after
              <input name="weeklyHours" aria-label="Weekly overtime hours" inputMode="decimal" required defaultValue={hours(rules.weeklyOtMinutes)} className="ctl mt-1 w-24" />
            </label>
            <label className="text-sm">
              Double time after
              <input name="doubleHours" aria-label="Double time hours" inputMode="decimal" defaultValue={hours(rules.dailyDtMinutes)} className="ctl mt-1 w-24" />
            </label>
            <label className="text-sm">
              OT multiplier
              <input name="otMultiplier" aria-label="Overtime multiplier" inputMode="decimal" defaultValue={(rules.otMultiplierBps / 10_000).toFixed(2)} className="ctl mt-1 w-24" />
            </label>
            <label className="text-sm">
              DT multiplier
              <input name="dtMultiplier" aria-label="Double time multiplier" inputMode="decimal" defaultValue={(rules.dtMultiplierBps / 10_000).toFixed(2)} className="ctl mt-1 w-24" />
            </label>
            <label className="text-sm">
              Burden %
              <input name="burdenPercent" aria-label="Labor burden percent" inputMode="decimal" defaultValue={percent(rules.burdenBps)} className="ctl mt-1 w-24" />
            </label>
          </div>
          <fieldset>
            <legend className="text-sm">OT days</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, index) => (
                <label key={name} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="otDay" value={index} defaultChecked={(rules.otDaysMask & (1 << index)) !== 0} />
                  {name.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="nonjobCounts" defaultChecked={rules.nonjobCountsTowardOt} />
            Non-job counts toward OT
          </label>
          <fieldset>
            <legend className="text-sm">Burden override %</legend>
            <ul className="mt-1 flex flex-col gap-1">
              {people.map((person) => (
                <li key={person.userId} className="flex items-center gap-2">
                  <input type="hidden" name="burdenUser" value={person.userId} />
                  <span className="w-36 truncate text-sm">{person.name}</span>
                  <input
                    name={`burden_${person.userId}`}
                    aria-label={`Burden percent for ${person.name}`}
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={percent(person.burdenPercent)}
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
        <ActionForm action={geoSettingsAction} className="flex max-w-md flex-col gap-3">
          <label className="text-sm">
            Geofence
            <select name="mode" aria-label="Geofence" defaultValue={geo.mode} className="ctl mt-1">
              <option value="off">Off</option>
              <option value="warn">Warn</option>
              <option value="require">Require location</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Radius
              <input name="radius" aria-label="Radius" inputMode="decimal" required defaultValue={geo.radius} className="ctl mt-1 w-24 num" />
            </label>
            <label className="text-sm">
              Unit
              <select name="unit" aria-label="Unit" defaultValue={geo.unit} className="ctl mt-1">
                <option value="ft">ft</option>
                <option value="m">m</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="text-sm">Require location</legend>
            <ul className="mt-1 flex flex-col gap-1">
              {geo.people.map((person) => (
                <li key={person.userId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="requireUser" value={person.userId} defaultChecked={person.requireLocation === 1} />
                    {person.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <button type="submit" className="ctl w-fit">
            Save geofence
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
