import { addCalendarDays } from "@/lib/time/calendar";

export type IcsEvent = {
  uid: string;
  title: string;
  startDate: string;
  endDate: string;
  description?: string | null;
};

/** TEXT escaping per RFC 5545. */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\n|\r/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function compactDate(day: string): string {
  return day.replace(/-/g, "");
}

function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  let limit = 75;
  while (Buffer.byteLength(rest) > limit) {
    let take = 0;
    let bytes = 0;
    for (const char of rest) {
      const size = Buffer.byteLength(char);
      if (bytes + size > limit) break;
      bytes += size;
      take += char.length;
    }
    if (take === 0) break;
    parts.push(rest.slice(0, take));
    rest = rest.slice(take);
    limit = 74;
  }
  if (rest) parts.push(rest);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

/** All-day events. DTEND is exclusive, the day after the last inclusive date. */
export function buildScheduleIcs(events: IcsEvent[], stamp = "20261006T120000Z"): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fieldline//Schedule//EN", "CALSCALE:GREGORIAN"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscape(event.uid)}@fieldline`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addCalendarDays(event.endDate, 1))}`);
    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
