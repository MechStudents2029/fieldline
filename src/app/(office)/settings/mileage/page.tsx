import Link from "next/link";
import { saveMileageRatesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { listMileageRates } from "@/lib/services/mileage";

export default async function MileageSettingsPage() {
  const session = await requireSession();
  const board = listMileageRates(session);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Mileage" subtitle={board.periods[0] ? board.periods[board.periods.length - 1]?.rateLabel : "0"} search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Mileage</h1>
        {board.canEdit ? (
          <ActionForm action={saveMileageRatesAction} className="flex flex-col gap-3">
            {board.periods.map((row) => (
              <div key={row.id} className="grid grid-cols-4 gap-2" data-rate={row.id}>
                <input type="hidden" name="periodId" value={row.id} />
                <label className="text-sm">
                  Starts
                  <input name="starts" aria-label={`Starts ${row.startsOn}`} type="date" required defaultValue={row.startsOn} className="field mt-1" />
                </label>
                <label className="text-sm">
                  Ends
                  <input name="ends" aria-label={`Ends ${row.startsOn}`} type="date" required defaultValue={row.endsOn} className="field mt-1" />
                </label>
                <label className="text-sm">
                  Rate
                  <input name="rate" aria-label={`Rate ${row.startsOn}`} inputMode="decimal" required defaultValue={row.rateLabel} className="field mt-1" />
                </label>
                <label className="text-sm">
                  IRS
                  <input name="irs" aria-label={`IRS ${row.startsOn}`} inputMode="decimal" required defaultValue={row.irsLabel} className="field mt-1" />
                </label>
              </div>
            ))}
            <div className="grid grid-cols-4 gap-2">
              <input type="hidden" name="periodId" value="" />
              <label className="text-sm">
                Starts
                <input name="starts" aria-label="New starts" type="date" className="field mt-1" />
              </label>
              <label className="text-sm">
                Ends
                <input name="ends" aria-label="New ends" type="date" className="field mt-1" />
              </label>
              <label className="text-sm">
                Rate
                <input name="rate" aria-label="New rate" inputMode="decimal" className="field mt-1" />
              </label>
              <label className="text-sm">
                IRS
                <input name="irs" aria-label="New IRS" inputMode="decimal" className="field mt-1" />
              </label>
            </div>
            <Button type="submit" className="h-11 w-fit">
              Save
            </Button>
          </ActionForm>
        ) : (
          <ul className="fl-group">
            {board.periods.length === 0 ? (
              <li className="fl-cell">
                <span className="num">0</span>
              </li>
            ) : null}
            {board.periods.map((row) => (
              <li key={row.id} className="fl-cell" data-rate={row.id}>
                <span className="num flex-1">{row.startsOn}</span>
                <span className="num">{row.endsOn}</span>
                <span className="num">{row.rateLabel}</span>
                <span className="num">{row.irsLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
