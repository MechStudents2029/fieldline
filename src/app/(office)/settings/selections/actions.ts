"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { saveSelectionFollowSettings } from "@/lib/services/selection-followups";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

export async function saveSelectionFollowSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const after = String(formData.get("after") || "").trim();
    saveSelectionFollowSettings(actor, {
      enabled: formData.get("enabled") === "on",
      before: Number(formData.get("before") || ""),
      after: after === "" ? 0 : Number(after),
      exclude: String(formData.get("exclude") || ""),
      template: String(formData.get("template") || ""),
    });
    revalidatePath("/settings/selections");
    revalidatePath("/selection-followups");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
