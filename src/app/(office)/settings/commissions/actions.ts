"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { saveCommissionPlan, savePlanOverride, setPlanStatus } from "@/lib/services/commissions";
import { ServiceError } from "@/lib/services/errors";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function refresh() {
  revalidatePath("/settings/commissions");
  revalidatePath("/commissions");
  revalidatePath("/");
}

export async function saveCommissionPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    saveCommissionPlan(actor, {
      name: String(formData.get("name") || ""),
      subject: String(formData.get("subject") || ""),
      basis: String(formData.get("basis") || ""),
      rate: String(formData.get("rate") || ""),
      deposit: String(formData.get("deposit") || ""),
      start: String(formData.get("start") || ""),
      completion: String(formData.get("completion") || ""),
    });
    refresh();
    return { ok: "Added." };
  } catch (error) {
    return failure(error);
  }
}

export async function setPlanStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    setPlanStatus(actor, String(formData.get("planId") || ""), String(formData.get("archived") || "") === "1");
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function savePlanOverrideAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    savePlanOverride(actor, String(formData.get("planId") || ""), String(formData.get("projectType") || ""), String(formData.get("rate") || ""));
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
