"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { assignDispatch } from "@/lib/services/dispatch";
import { ServiceError } from "@/lib/services/errors";

export async function assignDispatchAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    const intent = String(formData.get("intent") || "assign");
    const assignee = String(formData.get("assignee") || "");
    assignDispatch(session, {
      cardId: String(formData.get("card") || ""),
      assigneeId: intent === "unassign" ? null : assignee || null,
      start: String(formData.get("start") || "") || null,
      end: String(formData.get("end") || "") || null,
      day: String(formData.get("day") || ""),
    });
    revalidatePath("/dispatch");
    revalidatePath("/schedule");
    revalidatePath("/");
    return { ok: intent === "unassign" || !assignee ? "Unassigned" : "Assigned" };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}
