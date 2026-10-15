"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { applyLateFee, ensureStatement, markStatementSent, saveLatePolicy, waiveLateFee } from "@/lib/services/late-fees";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

export async function saveLatePolicyAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveLatePolicy(session, {
      enabled: formData.get("enabled") === "1",
      flat: String(formData.get("flat") ?? ""),
      percent: String(formData.get("percent") ?? ""),
      grace: String(formData.get("grace") ?? ""),
      minimum: String(formData.get("minimum") ?? ""),
      cap: String(formData.get("cap") ?? ""),
      excludeRetainage: formData.get("excludeRetainage") === "1",
      excludeDraws: formData.get("excludeDraws") === "1",
      excludeAgreements: formData.get("excludeAgreements") === "1",
      mode: String(formData.get("mode") ?? "review"),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/settings/billing");
  revalidatePath("/");
  return { ok: "Saved." };
}

export async function applyLateFeeAction(feeId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    applyLateFee(session, feeId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/fees");
  revalidatePath(`/fees/${feeId}`);
  revalidatePath("/");
  revalidatePath("/invoices");
  return { ok: "Applied." };
}

export async function waiveLateFeeAction(feeId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    waiveLateFee(session, feeId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/fees");
  revalidatePath(`/fees/${feeId}`);
  revalidatePath("/");
  return { ok: "Waived." };
}

export async function ensureStatementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let statementId = "";
  try {
    statementId = ensureStatement(session, String(formData.get("contactId") ?? "")).id;
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/statements");
  redirect(`/statements/${statementId}`);
}

export async function markStatementSentAction(statementId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markStatementSent(session, statementId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/statements/${statementId}`);
  return { ok: "Marked." };
}
