import { and, eq } from "drizzle-orm";
import { officeDb } from "@/lib/db/office";
import { memberships, notifications } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";

export function notifyDelivery(orgId: string, input: { entityType: string; entityId: string; projectId: string | null; snippet: string; actorName: string }) {
  const db = officeDb(orgId);
  if (!db) return;
  const existing = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.entityId, input.entityId), eq(notifications.snippet, input.snippet)))
    .get();
  if (existing) return;
  const members = db.select().from(memberships).where(eq(memberships.orgId, orgId)).all();
  const now = nowIso();
  for (const member of members) {
    if (member.role !== "owner" && member.role !== "admin") continue;
    db.insert(notifications)
      .values({
        id: id("note"),
        orgId,
        userId: member.userId,
        kind: "delivery",
        commentId: null,
        entityType: input.entityType,
        entityId: input.entityId,
        projectId: input.projectId,
        actorId: null,
        actorName: input.actorName,
        snippet: input.snippet,
        readAt: null,
        createdAt: now,
      })
      .run();
  }
}
