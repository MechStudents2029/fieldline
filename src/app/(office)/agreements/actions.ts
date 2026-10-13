"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { isBilling, isCadence, isTermKind } from "@/lib/agreements/cadence";
import { getSession } from "@/lib/auth/session";
import { parseMoneyToCents, qtyToMilli } from "@/lib/money";
import {
  acceptAgreement,
  acceptByToken,
  addVisits,
  assignVisit,
  cancelAgreement,
  completeVisit,
  createAgreement,
  linkVisit,
  moveVisit,
  renewAgreement,
  skipVisit,
} from "@/lib/services/agreements";
import { ServiceError } from "@/lib/services/errors";

function fail(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

export async function createAgreementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  const termKind = String(formData.get("termKind") ?? "");
  const cadence = String(formData.get("cadence") ?? "");
  const billing = String(formData.get("billing") ?? "");
  if (!isTermKind(termKind) || !isCadence(cadence) || !isBilling(billing)) return { error: "Pick a term, cadence, and billing rule." };
  const fixed = parseMoneyToCents(String(formData.get("fixed") ?? "")) ?? 0;
  const qty = Number(String(formData.get("qty") ?? "1"));
  const checklist = String(formData.get("checklist") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const customDates = String(formData.get("customDates") ?? "")
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    const created = createAgreement(session, {
      contactId: String(formData.get("contactId") ?? ""),
      projectId: String(formData.get("projectId") ?? "") || null,
      name: String(formData.get("name") ?? ""),
      startOn: String(formData.get("startOn") ?? ""),
      termKind,
      termMonths: Number(formData.get("termMonths") ?? 0) || null,
      endOn: String(formData.get("endOn") ?? "") || null,
      visitLimit: Number(formData.get("visitLimit") ?? 0) || null,
      cadence,
      intervalWeeks: Number(formData.get("intervalWeeks") ?? 1) || 1,
      customDates,
      billing,
      fixedCents: fixed,
      checklist,
      assigneeUserId: String(formData.get("assigneeUserId") ?? "") || null,
      notes: String(formData.get("notes") ?? ""),
      lines: [{ code: String(formData.get("code") ?? ""), qtyMilli: qtyToMilli(Number.isFinite(qty) ? qty : 0) }],
    });
    revalidatePath("/agreements");
    redirect(`/agreements/${created.id}`);
  } catch (error) {
    return fail(error);
  }
}

export async function acceptAgreementAction(agreementId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    acceptAgreement(session, agreementId);
    revalidatePath(`/agreements/${agreementId}`);
    revalidatePath("/schedule");
    return { ok: "Accepted" };
  } catch (error) {
    return fail(error);
  }
}

export async function renewAgreementAction(agreementId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    const child = renewAgreement(session, agreementId);
    revalidatePath("/agreements");
    redirect(`/agreements/${child.id}`);
  } catch (error) {
    return fail(error);
  }
}

export async function cancelAgreementAction(agreementId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    cancelAgreement(session, agreementId);
    revalidatePath(`/agreements/${agreementId}`);
    return { ok: "Cancelled" };
  } catch (error) {
    return fail(error);
  }
}

export async function addVisitsAction(agreementId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    addVisits(session, agreementId, {
      startOn: String(formData.get("startOn") ?? ""),
      count: Number(formData.get("count") ?? 1),
      gapDays: Number(formData.get("gapDays") ?? 1),
    });
    revalidatePath(`/agreements/${agreementId}`);
    revalidatePath("/schedule");
    return { ok: "Visits added" };
  } catch (error) {
    return fail(error);
  }
}

export async function completeVisitAction(agreementId: string, visitId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    completeVisit(session, visitId, formData.getAll("check").map(String));
    revalidatePath(`/agreements/${agreementId}`);
    revalidatePath("/schedule");
    revalidatePath("/invoices");
    return { ok: "Completed" };
  } catch (error) {
    return fail(error);
  }
}

export async function skipVisitAction(agreementId: string, visitId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    skipVisit(session, visitId, String(formData.get("reason") ?? ""));
    revalidatePath(`/agreements/${agreementId}`);
    revalidatePath("/schedule");
    return { ok: "Skipped" };
  } catch (error) {
    return fail(error);
  }
}

export async function moveVisitAction(agreementId: string, visitId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    moveVisit(session, visitId, String(formData.get("dueOn") ?? ""));
    revalidatePath(`/agreements/${agreementId}`);
    revalidatePath("/schedule");
    return { ok: "Moved" };
  } catch (error) {
    return fail(error);
  }
}

export async function assignVisitAction(agreementId: string, visitId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    const userId = String(formData.get("userId") ?? "");
    assignVisit(session, visitId, userId || null);
    revalidatePath(`/agreements/${agreementId}`);
    revalidatePath("/schedule");
    return { ok: "Assigned" };
  } catch (error) {
    return fail(error);
  }
}

export async function linkVisitAction(agreementId: string, visitId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in required." };
  try {
    linkVisit(session, visitId, String(formData.get("projectId") ?? ""));
    revalidatePath(`/agreements/${agreementId}`);
    return { ok: "Linked" };
  } catch (error) {
    return fail(error);
  }
}

export async function acceptPortalAgreementAction(portalToken: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    acceptByToken(String(formData.get("acceptToken") ?? ""), String(formData.get("name") ?? ""));
    revalidatePath(`/portal/${portalToken}`);
    return { ok: "Accepted" };
  } catch (error) {
    return fail(error);
  }
}
