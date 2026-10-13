"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { markReview, saveReviewTags } from "@/lib/services/reviews";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function refresh(id: string) {
  revalidatePath("/reviews");
  revalidatePath(`/reviews/${id}`);
  revalidatePath("/");
}

export async function markReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const requestId = String(formData.get("id") || "");
    const action = String(formData.get("action") || "");
    if (action === "copy" || action === "sent" || action === "skip" || action === "decline" || action === "ready") {
      markReview(actor, requestId, action, String(formData.get("reason") || ""));
    }
    refresh(requestId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function askReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const requestId = String(formData.get("id") || "");
    markReview(actor, requestId, "ready");
    markReview(actor, requestId, "copy");
    refresh(requestId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveReviewTagsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const requestId = String(formData.get("id") || "");
    saveReviewTags(actor, requestId, String(formData.get("tags") || ""));
    refresh(requestId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
