"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/money";
import {
  addBudgetChangeLine,
  approveBudgetChange,
  createBudgetChange,
  fundFromContingency,
  setBudgetLineKind,
  voidBudgetChange,
} from "@/lib/services/budget-changes";
import { ServiceError } from "@/lib/services/errors";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function cents(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return 0;
  const parsed = parseMoneyToCents(raw);
  if (parsed == null) throw new ServiceError("Enter an amount.");
  return parsed;
}

function refresh(changeId?: string, projectId?: string, eventId?: string) {
  revalidatePath("/budget-changes", "layout");
  revalidatePath("/");
  revalidatePath("/reports/wip", "layout");
  if (changeId) revalidatePath(`/budget-changes/${changeId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (eventId) revalidatePath(`/change-events/${eventId}`);
}

export async function createBudgetChangeAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  let changeId = "";
  try {
    changeId = createBudgetChange(session, projectId, {
      title: String(formData.get("title") ?? ""),
      type: String(formData.get("type") ?? ""),
      fromBudgetLineId: String(formData.get("fromBudgetLineId") ?? ""),
      fromCents: cents(formData, "amount"),
      lines: [{ budgetLineId: String(formData.get("toBudgetLineId") ?? ""), amountCents: cents(formData, "amount") }],
      note: String(formData.get("note") ?? ""),
      overrideNote: String(formData.get("overrideNote") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh(changeId, projectId);
  redirect(`/budget-changes/${changeId}`);
}

export async function addBudgetChangeLineAction(changeId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addBudgetChangeLine(session, changeId, String(formData.get("budgetLineId") ?? ""), cents(formData, "amount"));
  } catch (error) {
    return fail(error);
  }
  refresh(changeId);
  return { ok: "Added" };
}

export async function approveBudgetChangeAction(changeId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let projectId = "";
  let eventId = "";
  try {
    approveBudgetChange(session, changeId);
    const { budgetChangeDetail } = await import("@/lib/services/budget-changes");
    const detail = budgetChangeDetail(session, changeId);
    projectId = detail?.projectId ?? "";
    eventId = detail?.changeEventId ?? "";
  } catch (error) {
    return fail(error);
  }
  refresh(changeId, projectId, eventId);
  return { ok: "Approved" };
}

export async function voidBudgetChangeAction(changeId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let projectId = "";
  try {
    const { budgetChangeDetail } = await import("@/lib/services/budget-changes");
    projectId = budgetChangeDetail(session, changeId)?.projectId ?? "";
    voidBudgetChange(session, changeId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(changeId, projectId);
  return { ok: "Void" };
}

export async function setBudgetLineKindAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  try {
    setBudgetLineKind(session, String(formData.get("lineId") ?? ""), String(formData.get("kind") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(undefined, projectId);
  return { ok: "Marked" };
}

export async function fundFromContingencyAction(eventId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let changeId = "";
  try {
    changeId = fundFromContingency(session, eventId);
  } catch (error) {
    return fail(error);
  }
  refresh(changeId, undefined, eventId);
  redirect(`/budget-changes/${changeId}`);
}
