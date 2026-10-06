import { inclusiveDays } from "@/lib/schedule/range";

export type ConflictItem = {
  id: string;
  projectId: string;
  startDate: string;
  endDate: string;
  assigneeIds: string[];
};

export type ConflictHit = {
  userId: string;
  day: string;
  itemIds: string[];
};

/**
 * A person on two different jobs the same calendar day. Same job is not a conflict.
 * An all-day item covers every day in its range. Saving is never blocked.
 */
export function scheduleConflicts(items: ConflictItem[]): ConflictHit[] {
  const grouped = new Map<string, { userId: string; day: string; itemIds: Set<string>; projects: Set<string> }>();
  for (const item of items) {
    for (const day of inclusiveDays(item.startDate, item.endDate)) {
      for (const userId of item.assigneeIds) {
        const key = `${userId}|${day}`;
        const hit = grouped.get(key) ?? { userId, day, itemIds: new Set<string>(), projects: new Set<string>() };
        hit.itemIds.add(item.id);
        hit.projects.add(item.projectId);
        grouped.set(key, hit);
      }
    }
  }
  return [...grouped.values()]
    .filter((hit) => hit.projects.size > 1)
    .map((hit) => ({ userId: hit.userId, day: hit.day, itemIds: [...hit.itemIds].sort() }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.userId.localeCompare(b.userId));
}
