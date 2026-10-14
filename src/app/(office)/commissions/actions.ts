"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { markCommission, saveJobSplits } from "@/lib/services/commissions";
import { ServiceError } from "@/lib/services/errors";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

export async function markCommissionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const lineId = String(formData.get("id") || "");
    const action = String(formData.get("action") || "");
    if (action === "paid" || action === "void") markCommission(actor, lineId, action);
    revalidatePath("/commissions");
    revalidatePath(`/commissions/${lineId}`);
    revalidatePath("/");
    return { ok: action === "paid" ? "Marked paid." : "Voided." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveJobSplitsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const projectId = String(formData.get("projectId") || "");
    const rows = [0, 1, 2, 3].map((index) => ({
      userId: String(formData.get(`user${index}`) || ""),
      seat: String(formData.get(`seat${index}`) || ""),
      share: String(formData.get(`share${index}`) || ""),
    }));
    saveJobSplits(actor, projectId, {
      projectType: String(formData.get("projectType") || ""),
      mode: String(formData.get("mode") || ""),
      rows,
    });
    revalidatePath(`/projects/${projectId}/commissions`);
    revalidatePath("/commissions");
    revalidatePath("/");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
