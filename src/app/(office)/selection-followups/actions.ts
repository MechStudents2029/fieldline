"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { markSelectionFollowUp, saveSelectionFollowTags } from "@/lib/services/selection-followups";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function refresh(id: string) {
  revalidatePath("/selection-followups");
  revalidatePath(`/selection-followups/${id}`);
  revalidatePath("/");
}

export async function markSelectionFollowUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const followId = String(formData.get("id") || "");
    const action = String(formData.get("action") || "");
    if (action === "copy" || action === "sent" || action === "skip" || action === "void") {
      markSelectionFollowUp(actor, followId, action, String(formData.get("reason") || ""));
    }
    refresh(followId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveSelectionFollowTagsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const followId = String(formData.get("id") || "");
    saveSelectionFollowTags(actor, followId, String(formData.get("tags") || ""));
    refresh(followId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
