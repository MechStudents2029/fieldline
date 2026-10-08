const isoDate = /^(\d{4})-(\d{2})-(\d{2})/;

export type FormatWhenOptions = {
  now?: Date | number | string;
  timeZone?: string;
  withTime?: boolean;
};

function nowDate(now: FormatWhenOptions["now"]): Date {
  if (now instanceof Date) return now;
  if (typeof now === "number") return new Date(now);
  if (typeof now === "string" && now) return new Date(now);
  return new Date();
}

function sameYear(date: Date, now: Date, timeZone?: string): boolean {
  const year = new Intl.DateTimeFormat("en-US", { year: "numeric", ...(timeZone ? { timeZone } : {}) });
  return year.format(date) === year.format(now);
}

function dateLabel(date: Date, now: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear(date, now, timeZone) ? {} : { year: "numeric" }),
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** One display format. This year is `Oct 7`. Another year is `Oct 7, 2025`. A time is `2:30 PM`. */
export function formatWhen(value: string | null | undefined, options: FormatWhenOptions = {}): string {
  const raw = value?.trim() ?? "";
  const match = isoDate.exec(raw);
  if (!match) return "—";
  const now = nowDate(options.now);
  const hasTime = /T\d{2}:\d{2}/.test(raw);
  if (!hasTime || !options.withTime) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
    if (Number.isNaN(date.getTime())) return "—";
    return dateLabel(date, now, "UTC");
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  const zone = options.timeZone;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  }).format(date);
  return `${dateLabel(date, now, zone)}, ${time}`;
}

export function formatWarrantyDay(day: string | null | undefined, now?: FormatWhenOptions["now"]): string {
  return formatWhen(day, { now, timeZone: "UTC" });
}

export function formatCalendarDay(day: string | null | undefined, now?: FormatWhenOptions["now"]): string {
  return formatWhen(day, { now, timeZone: "UTC" });
}

export function formatDate(iso: string | null | undefined, now?: FormatWhenOptions["now"]): string {
  return formatWhen(iso, { now });
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string, now?: FormatWhenOptions["now"]): string {
  return formatWhen(iso, { now, timeZone, withTime: true });
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}
