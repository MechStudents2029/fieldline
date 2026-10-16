import { addMonths } from "@/lib/closeout/check";
import { addCalendarDays } from "@/lib/time/calendar";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function warrantyEnd(installOn: string | null | undefined, months: number | null | undefined): string | null {
  if (!installOn || !DATE.test(installOn) || months == null || !Number.isInteger(months) || months < 1) return null;
  return addMonths(installOn, months);
}

/** First due is install plus the interval. Roll forward until the date is today or later. */
export function nextMaintenance(installOn: string | null | undefined, intervalDays: number | null | undefined, today: string): string | null {
  if (!installOn || !DATE.test(installOn) || !DATE.test(today) || intervalDays == null || !Number.isInteger(intervalDays) || intervalDays < 1) return null;
  let due = addCalendarDays(installOn, intervalDays);
  let guard = 0;
  while (due < today && guard < 4000) {
    due = addCalendarDays(due, intervalDays);
    guard += 1;
  }
  return due;
}

export function missingDocs(items: { sectionKind: string; documentId: string | null }[]): number {
  return items.filter((item) => item.sectionKind === "installed" && !item.documentId).length;
}

/** A missing package is clear. A draft package blocks close. Ready and delivered do not. */
export function closeoutHandover(status: string | null | undefined): number {
  return status === "draft" ? 1 : 0;
}
