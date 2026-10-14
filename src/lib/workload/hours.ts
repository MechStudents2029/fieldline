import { addCalendarDays } from "@/lib/time/calendar";
import { isWorkday, type WorkdayCalendar } from "@/lib/schedule/workdays";

/**
 * Booked time for capacity.
 * Hours set on an item (`plannedMinutes`) are the total for the whole span,
 * spread across that span's workdays. A start and end clock, with no hours
 * set, counts on every workday. Otherwise each workday is 8 hours.
 * Weekends and other company days off get nothing. The same person and key
 * count once. Approved PTO reduces that week's capacity and is not booked time.
 */
export const DEFAULT_DAY_MINUTES = 8 * 60;
export const DEFAULT_WEEK_MINUTES = 40 * 60;
export const WORKLOAD_WEEKS = 8;

export type HoursSource = "schedule" | "visit" | "booking";

export type LoadBlock = {
  key: string;
  personId: string;
  startDate: string;
  endDate: string;
  plannedMinutes: number | null;
  startMin: number | null;
  endMin: number | null;
  title: string;
  job: string;
  source: HoursSource;
  href: string;
  crewId: string | null;
  calendar?: WorkdayCalendar;
};

export type PtoBlock = {
  personId: string;
  day: string;
  minutes: number;
};

export type CapacityPerson = {
  id: string;
  name: string;
  role: string;
  capacityMinutes: number | null;
  kind: "member" | "vendor";
};

export type WeekSpan = { start: string; end: string };

export type CellItem = {
  key: string;
  title: string;
  job: string;
  source: HoursSource;
  minutes: number;
  href: string;
  crewId: string | null;
};

export type WorkCell = {
  booked: number;
  capacity: number;
  pto: number;
  percent: number | null;
  over: boolean;
  items: CellItem[];
};

export type WorkRow = {
  person: CapacityPerson;
  cells: WorkCell[];
};

export function weekColumns(anchorDay: string, weekStartsOn: number, count = WORKLOAD_WEEKS): WeekSpan[] {
  const [year, month, date] = anchorDay.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, (month ?? 1) - 1, date ?? 1)).getUTCDay();
  const startDow = ((weekStartsOn % 7) + 7) % 7;
  const start = addCalendarDays(anchorDay, -((weekday - startDow + 7) % 7));
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addCalendarDays(start, index * 7);
    return { start: weekStart, end: addCalendarDays(weekStart, 6) };
  });
}

export function weeksCovering(start: string, end: string, weekStartsOn: number): WeekSpan[] {
  const first = weekColumns(start, weekStartsOn, 1)[0]!;
  const weeks: WeekSpan[] = [];
  let cursor = first.start;
  const last = end < start ? start : end;
  while (cursor <= last && weeks.length < 12) {
    weeks.push({ start: cursor, end: addCalendarDays(cursor, 6) });
    cursor = addCalendarDays(cursor, 7);
  }
  return weeks;
}

export function workdaysIn(start: string, end: string, calendar: WorkdayCalendar): string[] {
  if (!start || !end || end < start) return [];
  const days: string[] = [];
  let cursor = start;
  for (let guard = 0; guard < 400 && cursor <= end; guard += 1) {
    if (isWorkday(cursor, calendar)) days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

/** Minutes per workday. `total` is spread. `each` repeats. */
export function blockPlacement(block: Pick<LoadBlock, "plannedMinutes" | "startMin" | "endMin">): { mode: "total" | "each"; minutes: number } {
  if (block.plannedMinutes != null) return { mode: "total", minutes: Math.max(0, Math.round(block.plannedMinutes)) };
  if (block.startMin != null && block.endMin != null && block.endMin > block.startMin) {
    return { mode: "each", minutes: block.endMin - block.startMin };
  }
  return { mode: "each", minutes: DEFAULT_DAY_MINUTES };
}

export function minutesByDay(block: LoadBlock, calendar: WorkdayCalendar): Map<string, number> {
  const days = workdaysIn(block.startDate, block.endDate, block.calendar ?? calendar);
  const spec = blockPlacement(block);
  const map = new Map<string, number>();
  if (days.length === 0 || spec.minutes <= 0) return map;
  if (spec.mode === "each") {
    for (const day of days) map.set(day, spec.minutes);
    return map;
  }
  const base = Math.floor(spec.minutes / days.length);
  let remainder = spec.minutes - base * days.length;
  for (const day of days) {
    const extra = remainder > 0 ? 1 : 0;
    if (extra) remainder -= 1;
    const minutes = base + extra;
    if (minutes > 0) map.set(day, minutes);
  }
  return map;
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

export function hoursNumber(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return String(hours);
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function capacityWarningText(rows: { name: string; booked: number; capacity: number }[]): string | null {
  const over = rows.filter((row) => row.booked > row.capacity);
  if (over.length === 0) return null;
  return over.map((row) => `${row.name} ${formatHours(row.booked)} / ${formatHours(row.capacity)}`).join(", ");
}

function emptyCell(capacity: number): WorkCell {
  return { booked: 0, capacity, pto: 0, percent: capacity === 0 ? 0 : 0, over: false, items: [] };
}

function finishCell(cell: WorkCell) {
  cell.capacity = Math.max(0, cell.capacity - cell.pto);
  cell.percent = cell.capacity === 0 ? (cell.booked > 0 ? null : 0) : Math.round((cell.booked / cell.capacity) * 100);
  cell.over = cell.booked > cell.capacity;
}

export function buildWorkload(input: {
  people: CapacityPerson[];
  blocks: LoadBlock[];
  pto: PtoBlock[];
  weeks: WeekSpan[];
  companyMinutes: number;
  calendar: WorkdayCalendar;
}): WorkRow[] {
  const company = input.companyMinutes > 0 ? input.companyMinutes : DEFAULT_WEEK_MINUTES;
  const rows: WorkRow[] = input.people.map((person) => ({
    person,
    cells: input.weeks.map(() => emptyCell(person.capacityMinutes != null ? person.capacityMinutes : company)),
  }));
  const index = new Map(rows.map((row, position) => [row.person.id, position]));
  const seen = new Set<string>();
  for (const block of input.blocks) {
    const position = index.get(block.personId);
    if (position == null) continue;
    const stamp = `${block.personId}|${block.key}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    const perDay = minutesByDay(block, input.calendar);
    const byWeek = new Map<number, number>();
    for (const [day, minutes] of perDay) {
      const week = input.weeks.findIndex((span) => span.start <= day && day <= span.end);
      if (week < 0) continue;
      byWeek.set(week, (byWeek.get(week) ?? 0) + minutes);
    }
    const row = rows[position]!;
    for (const [week, minutes] of byWeek) {
      const cell = row.cells[week]!;
      cell.booked += minutes;
      cell.items.push({
        key: block.key,
        title: block.title,
        job: block.job,
        source: block.source,
        minutes,
        href: block.href,
        crewId: block.crewId,
      });
    }
  }
  for (const pto of input.pto) {
    const position = index.get(pto.personId);
    if (position == null || pto.minutes <= 0) continue;
    const week = input.weeks.findIndex((span) => span.start <= pto.day && pto.day <= span.end);
    if (week < 0) continue;
    rows[position]!.cells[week]!.pto += pto.minutes;
  }
  for (const row of rows) {
    for (const cell of row.cells) finishCell(cell);
  }
  return rows;
}
