"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { bpsOf, moneyOf } from "@/lib/services/pay-applications";
import {
  approvePayApplication,
  copyPayLink,
  createPayApplication,
  markPayRequested,
  markUnderReview,
  revisePayApplication,
  savePayApplication,
  setProgressBilling,
  submitPayApplication,
  voidPayApplication,
} from "@/lib/services/pay-applications";
import { ServiceError } from "@/lib/services/errors";

function fail(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function linesFrom(formData: FormData, office: boolean) {
  const ids = formData.getAll("lineId").map(String);
  return ids.map((purchaseOrderLineId) => ({
    purchaseOrderLineId,
    thisPeriodCents: moneyOf(String(formData.get(`this_${purchaseOrderLineId}`) ?? "")),
    storedCents: moneyOf(String(formData.get(`stored_${purchaseOrderLineId}`) ?? "")),
    releasedCents: moneyOf(String(formData.get(`released_${purchaseOrderLineId}`) ?? "")),
    retainageBps: office ? bpsOf(String(formData.get(`bps_${purchaseOrderLineId}`) ?? ""), 0) : undefined,
  }));
}

export async function createPayApplicationAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let applicationId = "";
  try {
    const created = createPayApplication(session, String(formData.get("purchaseOrderId") ?? ""), {
      periodStart: String(formData.get("periodStart") ?? ""),
      periodEnd: String(formData.get("periodEnd") ?? ""),
    });
    applicationId = created.id;
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/pay-applications");
  redirect(`/pay-applications/${applicationId}`);
}

export async function savePayApplicationAction(applicationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    savePayApplication(session, applicationId, { lines: linesFrom(formData, true), officeBps: true });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  return { ok: "Saved" };
}

export async function submitPayApplicationAction(applicationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    submitPayApplication(session, applicationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  revalidatePath("/pay-applications");
  return { ok: "Submitted" };
}

export async function reviewPayApplicationAction(applicationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markUnderReview(session, applicationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  return { ok: "Under review" };
}

export async function revisePayApplicationAction(applicationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    const notes = formData.getAll("lineId").map(String).map((purchaseOrderLineId) => ({
      purchaseOrderLineId,
      rejectNote: String(formData.get(`note_${purchaseOrderLineId}`) ?? ""),
    }));
    revisePayApplication(session, applicationId, notes);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  return { ok: "Revise" };
}

export async function approvePayApplicationAction(applicationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    approvePayApplication(session, applicationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  revalidatePath("/bills");
  revalidatePath("/pay-applications");
  return { ok: "Approved" };
}

export async function voidPayApplicationAction(applicationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    voidPayApplication(session, applicationId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  revalidatePath("/bills");
  return { ok: "Void" };
}

export async function markPayRequestedAction(applicationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markPayRequested(session, applicationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/pay-applications/${applicationId}`);
  return { ok: "Requested" };
}

export async function copyPayLinkAction(applicationId: string) {
  const session = await requireSession();
  try {
    copyPayLink(session, applicationId);
  } catch {
    return;
  }
  revalidatePath(`/pay-applications/${applicationId}`);
}

export async function setProgressBillingAction(purchaseOrderId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    setProgressBilling(session, purchaseOrderId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  return { ok: "Progress" };
}

export async function submitPortalPayAppAction(token: string, applicationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const { submitPortalPayApp } = await import("@/lib/services/vendor-portal");
  try {
    const ids = formData.getAll("lineId").map(String);
    submitPortalPayApp({
      token,
      ip: "portal",
      applicationId,
      lines: ids.map((purchaseOrderLineId) => ({
        purchaseOrderLineId,
        thisPeriodCents: moneyOf(String(formData.get(`this_${purchaseOrderLineId}`) ?? "")),
        storedCents: moneyOf(String(formData.get(`stored_${purchaseOrderLineId}`) ?? "")),
        releasedCents: moneyOf(String(formData.get(`released_${purchaseOrderLineId}`) ?? "")),
      })),
    });
  } catch (error) {
    return fail(error);
  }
  return { ok: "Submitted" };
}
