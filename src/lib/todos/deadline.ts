import { addCalendarDays } from "@/lib/time/calendar";
import { addWorkdays, DEFAULT_WORKDAY_MASK } from "@/lib/schedule/workdays";

export type DeadlineEdge = "start" | "finish";

/** Workday offset from a schedule edge. Negative is before, positive is after, zero is that edge. */
export function linkedDeadline(anchorDay: string, offset: number, mask = DEFAULT_WORKDAY_MASK): string {
  if (!Number.isInteger(offset) || offset < -60 || offset > 60) throw new Error("Offset is -60 to 60 workdays.");
  return addWorkdays(anchorDay, offset, mask);
}

export function deadlinePhrase(edge: DeadlineEdge, offset: number): string {
  if (offset === 0) return edge === "start" ? "On start" : "On finish";
  const count = Math.abs(offset);
  const unit = count === 1 ? "workday" : "workdays";
  const when = offset < 0 ? "before" : "after";
  return `${count} ${unit} ${when} ${edge}`;
}

export function reminderDay(due: string, daysBefore: number): string {
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 60) throw new Error("Reminder is 0 to 60 days.");
  return addCalendarDays(due, -daysBefore);
}

export function checklistFraction(done: number, total: number): string {
  return `${done}/${total}`;
}
