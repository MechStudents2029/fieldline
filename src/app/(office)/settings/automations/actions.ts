"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { ruleFromForm, saveAutomation, toggleAutomation } from "@/lib/services/automations";
import { ServiceError } from "@/lib/services/errors";

export async function saveAutomationAction(_prev: { error?: string } | null, formData: FormData) {
  const session = await requireSession();
  let saved = "";
  try {
    saved = saveAutomation(session, ruleFromForm(formData));
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Could not save." };
  }
  revalidatePath("/settings/automations");
  redirect(`/settings/automations?rule=${saved}`);
}

export async function toggleAutomationAction(formData: FormData) {
  const session = await requireSession();
  toggleAutomation(session, String(formData.get("id") || ""), String(formData.get("enabled") || "") === "1");
  revalidatePath("/settings/automations");
}
