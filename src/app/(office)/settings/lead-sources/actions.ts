"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { createLeadSource, parseSpendInput, setLeadSource, setLeadSourceSpend, setLeadSourceStatus } from "@/lib/services/lead-sources";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function refresh(leadId?: string) {
  revalidatePath("/settings/lead-sources");
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/reports/builtin/lead_sources");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function createLeadSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    createLeadSource(actor, String(formData.get("name") || ""));
    refresh();
    return { ok: "Added." };
  } catch (error) {
    return failure(error);
  }
}

export async function setLeadSourceSpendAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    setLeadSourceSpend(actor, String(formData.get("sourceId") || ""), String(formData.get("month") || ""), parseSpendInput(String(formData.get("spend") || "")));
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function setLeadSourceStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    setLeadSourceStatus(actor, String(formData.get("sourceId") || ""), String(formData.get("archived") || "") === "1");
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function setLeadSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    const leadId = String(formData.get("leadId") || "");
    setLeadSource(actor, leadId, String(formData.get("sourceId") || ""));
    refresh(leadId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
