"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { markFollowUp, saveFollowUpTags } from "@/lib/services/collections";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function refresh(id: string) {
  revalidatePath("/collections");
  revalidatePath(`/collections/${id}`);
  revalidatePath("/");
}

export async function markFollowUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const followId = String(formData.get("id") || "");
    const action = String(formData.get("action") || "");
    if (action === "copy" || action === "sent" || action === "skip" || action === "void") {
      markFollowUp(actor, followId, action, String(formData.get("reason") || ""));
    }
    refresh(followId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveFollowUpTagsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const followId = String(formData.get("id") || "");
    saveFollowUpTags(actor, followId, String(formData.get("tags") || ""));
    refresh(followId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
