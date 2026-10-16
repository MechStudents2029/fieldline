import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { meetingActions, tasks } from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";

/** Completing a to-do marks the linked meeting action done. */
export function markActionsDoneForTodos(db: AppDatabase, orgId: string, taskIds: string[]) {
  if (taskIds.length === 0) return;
  db.update(meetingActions)
    .set({ status: "done", updatedAt: nowIso() })
    .where(and(eq(meetingActions.orgId, orgId), eq(meetingActions.status, "open"), inArray(meetingActions.todoId, taskIds)))
    .run();
}

/** Completing a meeting action marks the linked to-do done. */
export function markTodoDone(db: AppDatabase, orgId: string, todoId: string) {
  db.update(tasks)
    .set({ status: "done", updatedAt: nowIso() })
    .where(and(eq(tasks.orgId, orgId), eq(tasks.id, todoId), eq(tasks.status, "open")))
    .run();
}
