"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { saveReviewSettings } from "@/lib/services/reviews";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

export async function saveReviewSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    saveReviewSettings(actor, {
      enabled: formData.get("enabled") === "on",
      timing: String(formData.get("timing") || ""),
      google: String(formData.get("google") || ""),
      facebook: String(formData.get("facebook") || ""),
      website: String(formData.get("website") || ""),
      exclude: String(formData.get("exclude") || ""),
      template: String(formData.get("template") || ""),
    });
    revalidatePath("/settings/reviews");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
