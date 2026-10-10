import { addCalendarDays } from "@/lib/time/calendar";

export type HolidayRow = { title: string; date: string; yearly: boolean };

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** nth is 1-based. weekday 0 is Sunday. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const date = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  return ymd(year, month, date);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const date = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
  return ymd(year, month, date);
}

/** Saturday observes Friday. Sunday observes Monday. */
function observed(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const week = weekday(year!, month!, day!);
  if (week === 6) return addCalendarDays(date, -1);
  if (week === 0) return addCalendarDays(date, 1);
  return date;
}

/** US federal holidays for one year. Fixed dates can repeat yearly. Weekend holidays also list the observed weekday. */
export function usFederalHolidays(year: number): HolidayRow[] {
  const fixed: { title: string; date: string }[] = [
    { title: "New Year's Day", date: ymd(year, 1, 1) },
    { title: "Juneteenth", date: ymd(year, 6, 19) },
    { title: "Independence Day", date: ymd(year, 7, 4) },
    { title: "Veterans Day", date: ymd(year, 11, 11) },
    { title: "Christmas", date: ymd(year, 12, 25) },
  ];
  const floating: HolidayRow[] = [
    { title: "Birthday of Martin Luther King, Jr.", date: nthWeekday(year, 1, 1, 3), yearly: false },
    { title: "Washington's Birthday", date: nthWeekday(year, 2, 1, 3), yearly: false },
    { title: "Memorial Day", date: lastWeekday(year, 5, 1), yearly: false },
    { title: "Labor Day", date: nthWeekday(year, 9, 1, 1), yearly: false },
    { title: "Columbus Day", date: nthWeekday(year, 10, 1, 2), yearly: false },
    { title: "Thanksgiving", date: nthWeekday(year, 11, 4, 4), yearly: false },
  ];
  const rows: HolidayRow[] = [];
  for (const holiday of fixed) {
    rows.push({ title: holiday.title, date: holiday.date, yearly: true });
    const off = observed(holiday.date);
    if (off !== holiday.date) rows.push({ title: `${holiday.title} observed`, date: off, yearly: false });
  }
  return rows.concat(floating);
}
