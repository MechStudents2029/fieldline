import { and, eq } from "drizzle-orm";
import { officeDb } from "@/lib/db/office";
import { userPrefs } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import type { Actor } from "@/lib/services/read";

const ALLOWED: Record<string, string[]> = {
  jobScheduleView: ["list", "gantt"],
  scheduleView: ["grid", "gantt"],
  ganttZoom: ["week", "month", "quarter"],
};

export function getPref(actor: Actor, key: string): string | null {
  const allowed = ALLOWED[key];
  if (!allowed) return null;
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const row = db
    .select({ value: userPrefs.value })
    .from(userPrefs)
    .where(and(eq(userPrefs.orgId, actor.orgId), eq(userPrefs.userId, actor.userId), eq(userPrefs.key, key)))
    .get();
  return row && allowed.includes(row.value) ? row.value : null;
}

export function setPref(actor: Actor, key: string, value: string) {
  const allowed = ALLOWED[key];
  if (!allowed || !allowed.includes(value)) return;
  const db = officeDb(actor.orgId);
  if (!db) return;
  const existing = db
    .select({ id: userPrefs.id })
    .from(userPrefs)
    .where(and(eq(userPrefs.orgId, actor.orgId), eq(userPrefs.userId, actor.userId), eq(userPrefs.key, key)))
    .get();
  if (existing) {
    db.update(userPrefs).set({ value }).where(eq(userPrefs.id, existing.id)).run();
    return;
  }
  db.insert(userPrefs).values({ id: id("pref"), orgId: actor.orgId, userId: actor.userId, key, value }).run();
}
