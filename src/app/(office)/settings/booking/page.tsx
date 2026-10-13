import Link from "next/link";
import { addOffAction, saveBookingPrefsAction, saveServiceAction, saveTechAction } from "@/app/(office)/settings/booking/actions";
import { ActionForm } from "@/components/action-form";
import { CopyLink } from "@/components/copy-link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { appOrigin } from "@/lib/security";
import { bookingBoard } from "@/lib/services/booking";
import { WEEKDAY_NAMES } from "@/lib/time/calendar";

export default async function BookingSettingsPage() {
  const session = await requireSession();
  const board = bookingBoard(session);
  if (!board) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Bookings</h1>
        <p className="text-sm">Only an owner or admin can change booking.</p>
      </div>
    );
  }
  const origin = appOrigin(process.env) ?? "";
  const url = board.token ? `${origin}/book/${board.token}` : "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar title="Bookings" subtitle={board.enabled ? "On" : "Off"} search={false} leading={<Link href="/settings">Settings</Link>} />
      <div className="flex flex-col gap-6 overflow-auto px-4 pb-10 md:px-6">
        <ActionForm action={saveBookingPrefsAction} className="flex max-w-xl flex-col gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="enabled" defaultChecked={board.enabled} />
            On
          </label>
          {url ? <CopyLink url={url} /> : null}
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((name, index) => (
              <label key={name} className="mac-glass-btn">
                <input type="checkbox" name="day" value={index} defaultChecked={(board.daysMask & (1 << index)) !== 0} /> {name.slice(0, 3)}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-[13px]">
              Start
              <input name="start" defaultValue={board.start} aria-label="Start" className="field mt-1" />
            </label>
            <label className="text-[13px]">
              End
              <input name="end" defaultValue={board.end} aria-label="End" className="field mt-1" />
            </label>
            <label className="text-[13px]">
              Earliest hours
              <input name="earliest" defaultValue={String(board.earliestHours)} inputMode="numeric" aria-label="Earliest hours" className="field mt-1" />
            </label>
            <label className="text-[13px]">
              Interval
              <select name="interval" defaultValue={String(board.intervalMin)} aria-label="Interval" className="field mt-1">
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="60">60</option>
              </select>
            </label>
            <label className="text-[13px]">
              Buffer
              <select name="buffer" defaultValue={String(board.bufferMin)} aria-label="Buffer" className="field mt-1">
                <option value="0">0</option>
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="60">60</option>
              </select>
            </label>
          </div>
          <label className="text-[13px]">
            Questions
            <textarea name="questions" defaultValue={board.questions} aria-label="Questions" className="field mt-1" rows={2} />
          </label>
          <button type="submit" className="mac-primary w-fit">Save</button>
        </ActionForm>
        <section className="flex flex-col gap-2" data-testid="bookable-services">
          <h2 className="text-[13px]">Services</h2>
          {board.services.map((service) => (
            <ActionForm key={service.id} action={saveServiceAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="itemId" value={service.id} />
              <p className="min-w-32 text-[13px]">{service.name}</p>
              <input name="duration" defaultValue={String(service.durationMin)} aria-label={`${service.name} duration`} className="field w-20" />
              <input name="price" defaultValue={service.price} aria-label={`${service.name} price`} className="field w-24" />
              {board.techs.map((tech) => (
                <label key={tech.id} className="text-[13px]">
                  <input type="checkbox" name="staff" value={tech.id} defaultChecked={service.staff.length === 0 || service.staff.includes(tech.id)} /> {tech.name.split(" ")[0]}
                </label>
              ))}
              <button type="submit" className="mac-glass-btn">Save</button>
              <button type="submit" name="bookable" value="0" className="mac-glass-btn">Remove</button>
            </ActionForm>
          ))}
          {board.catalog.length > 0 ? (
            <ActionForm action={saveServiceAction} className="flex flex-wrap items-end gap-2">
              <select name="itemId" aria-label="Price book" className="field" defaultValue={board.catalog[0]?.id}>
                {board.catalog.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <input name="duration" defaultValue="60" aria-label="Duration" className="field w-20" />
              <input name="price" aria-label="Price" className="field w-24" placeholder="Price" />
              <button type="submit" className="mac-glass-btn">Add</button>
            </ActionForm>
          ) : null}
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px]">Techs</h2>
          {board.techs.map((tech) => (
            <ActionForm key={tech.id} action={saveTechAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="userId" value={tech.id} />
              <label className="text-[13px]">
                <input type="checkbox" name="bookable" defaultChecked={tech.bookable} /> {tech.name}
              </label>
              <input name="start" defaultValue={tech.start} aria-label={`${tech.name} start`} className="field w-24" />
              <input name="end" defaultValue={tech.end} aria-label={`${tech.name} end`} className="field w-24" />
              <button type="submit" className="mac-glass-btn">Save</button>
            </ActionForm>
          ))}
          <ActionForm action={addOffAction} className="flex flex-wrap items-center gap-2">
            <select name="userId" aria-label="Time off" className="field" defaultValue={board.techs[0]?.id}>
              {board.techs.map((tech) => (
                <option key={tech.id} value={tech.id}>{tech.name}</option>
              ))}
            </select>
            <input name="start" aria-label="Off start" className="field w-36" placeholder="YYYY-MM-DD" />
            <input name="end" aria-label="Off end" className="field w-36" placeholder="YYYY-MM-DD" />
            <button type="submit" className="mac-glass-btn">Time off</button>
          </ActionForm>
          {board.offs.map((row) => (
            <p key={row.id} className="text-[13px] text-[var(--mac-secondary)]">{row.name} · {row.start} – {row.end}</p>
          ))}
        </section>
      </div>
    </div>
  );
}
