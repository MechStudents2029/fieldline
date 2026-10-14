"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { saveCollectSettings } from "@/lib/services/collections";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

export async function saveCollectSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const second = String(formData.get("second") || "").trim();
    saveCollectSettings(actor, {
      enabled: formData.get("enabled") === "on",
      first: Number(formData.get("first") || ""),
      second: second === "" ? 0 : Number(second),
      exclude: String(formData.get("exclude") || ""),
      template: String(formData.get("template") || ""),
    });
    revalidatePath("/settings/collections");
    revalidatePath("/collections");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
