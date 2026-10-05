/**
 * Company calendar. Instants stay UTC. A local day is the calendar date in the
 * company time zone. A workweek starts at local midnight on the chosen weekday
 * and runs seven calendar days. The start hour is midnight; an hour-of-day
 * workweek start is not a setting. Spring-forward and fall-back change the
 * length of that local day (23h or 25h). A wall time that does not exist moves
 * forward to the next real minute. A repeated wall time uses the earlier one.
 */

export const DEFAULT_TIME_ZONE = "America/New_York";
export const DEFAULT_WEEK_START = 1;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type WorkCalendar = {
  timeZone: string;
  weekStartsOn: number;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 100 || /[\u0000-\u001f]/.test(timeZone)) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function weekdayName(weekStartsOn: number): string {
  return WEEKDAY_NAMES[((weekStartsOn % 7) + 7) % 7] ?? "Monday";
}

export function localDay(instant: number, timeZone: string): string {
  const parts = partsInZone(instant, timeZone);
  return isoDate(parts.year, parts.month, parts.day);
}

export function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return shifted.toISOString().slice(0, 10);
}

export function localWeek(instant: number, calendar: WorkCalendar): { start: number; end: number; startDay: string } {
  const day = localDay(instant, calendar.timeZone);
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const startDow = ((calendar.weekStartsOn % 7) + 7) % 7;
  const startDay = addCalendarDays(day, -((weekday - startDow + 7) % 7));
  const start = zonedMidnight(startDay, calendar.timeZone);
  const end = zonedMidnight(addCalendarDays(startDay, 7), calendar.timeZone);
  return { start, end, startDay };
}

export function localDayBounds(day: string, timeZone: string): { start: number; end: number } {
  return { start: zonedMidnight(day, timeZone), end: zonedMidnight(addCalendarDays(day, 1), timeZone) };
}

/** `YYYY-MM-DDTHH:mm` in the company zone, for a datetime-local input. */
export function formatLocalInput(iso: string, timeZone: string): string {
  const parts = partsInZone(Date.parse(iso), timeZone);
  return `${isoDate(parts.year, parts.month, parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const nominal = Date.UTC(year, month - 1, day, hour, minute, second);
  let earliest: number | null = null;
  let afterGap: number | null = null;
  for (let deltaMinutes = -16 * 60; deltaMinutes <= 16 * 60; deltaMinutes += 1) {
    const instant = nominal + deltaMinutes * 60_000;
    const parts = partsInZone(instant, timeZone);
    if (parts.year !== year || parts.month !== month || parts.day !== day) continue;
    if (parts.hour === hour && parts.minute === minute && parts.second === second) {
      if (earliest == null || instant < earliest) earliest = instant;
      continue;
    }
    const later =
      parts.hour > hour || (parts.hour === hour && parts.minute > minute) || (parts.hour === hour && parts.minute === minute && parts.second > second);
    if (later && (afterGap == null || instant < afterGap)) afterGap = instant;
  }
  if (earliest != null) return earliest;
  if (afterGap != null) return afterGap;
  throw new Error(`Cannot place ${year}-${month}-${day} ${hour}:${minute} in ${timeZone}.`);
}

function zonedMidnight(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return zonedTimeToUtc(year, month, date, 0, 0, 0, timeZone);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, created);
  return created;
}

function partsInZone(instant: number, timeZone: string): ZonedParts {
  const bag: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}
