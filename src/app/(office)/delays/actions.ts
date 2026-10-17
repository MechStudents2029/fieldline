"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import {
  addDelayLabor,
  applyDelayDays,
  attachDelayFile,
  convertDelay,
  copyDelayLink,
  createDelay,
  documentDelay,
  linkDelayItem,
  markDelayShared,
  removeDelayLabor,
  saveDelay,
  voidDelay,
  waiveDelay,
} from "@/lib/services/delays";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function hours(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return 0;
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(raw)) throw new ServiceError("Enter hours.");
  return Math.round(Number(raw) * 1000);
}

function days(formData: FormData, name: string): number | undefined {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return undefined;
  if (!/^\d{1,3}$/.test(raw)) throw new ServiceError("Enter days.");
  return Number(raw);
}

function refresh(claimId?: string, projectId?: string) {
  revalidatePath("/delays", "layout");
  revalidatePath("/reports/delays");
  revalidatePath("/");
  if (claimId) revalidatePath(`/delays/${claimId}`);
  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/delays`);
  }
}

export async function createDelayAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  let claimId = "";
  try {
    claimId = createDelay(session, projectId, {
      title: String(formData.get("title") ?? ""),
      cause: String(formData.get("cause") ?? ""),
      impact: String(formData.get("impact") ?? ""),
      startedAt: String(formData.get("startedAt") ?? ""),
      endedAt: String(formData.get("endedAt") ?? ""),
      weatherNote: String(formData.get("weatherNote") ?? ""),
      idleHoursMilli: hours(formData, "idleHours"),
      scheduleDays: days(formData, "scheduleDays"),
      labor: [{ costCode: String(formData.get("costCode") ?? ""), trade: String(formData.get("trade") ?? ""), hoursMilli: hours(formData, "hours") }],
    });
  } catch (error) {
    return fail(error);
  }
  refresh(claimId, projectId);
  redirect(`/delays/${claimId}`);
}

export async function saveDelayAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveDelay(session, claimId, {
      title: String(formData.get("title") ?? ""),
      cause: String(formData.get("cause") ?? ""),
      impact: String(formData.get("impact") ?? ""),
      startedAt: String(formData.get("startedAt") ?? ""),
      endedAt: String(formData.get("endedAt") ?? ""),
      weatherNote: String(formData.get("weatherNote") ?? ""),
      idleHoursMilli: hours(formData, "idleHours"),
      scheduleDays: days(formData, "scheduleDays"),
    });
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Saved" };
  } catch (error) {
    return fail(error);
  }
}

export async function addDelayLaborAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addDelayLabor(session, claimId, {
      costCode: String(formData.get("costCode") ?? ""),
      trade: String(formData.get("trade") ?? ""),
      hoursMilli: hours(formData, "hours"),
    });
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Added" };
  } catch (error) {
    return fail(error);
  }
}

export async function removeDelayLaborAction(laborId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    removeDelayLabor(session, laborId);
    refresh(String(formData.get("claimId") ?? ""), String(formData.get("projectId") ?? ""));
    return { ok: "Removed" };
  } catch (error) {
    return fail(error);
  }
}

export async function linkDelayItemAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    linkDelayItem(session, claimId, String(formData.get("scheduleItemId") ?? ""));
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Linked" };
  } catch (error) {
    return fail(error);
  }
}

export async function applyDelayDaysAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    applyDelayDays(session, claimId);
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Applied" };
  } catch (error) {
    return fail(error);
  }
}

export async function attachDelayFileAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    attachDelayFile(session, claimId, String(formData.get("documentId") ?? ""));
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Attached" };
  } catch (error) {
    return fail(error);
  }
}

export async function documentDelayAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    documentDelay(session, claimId);
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Documented" };
  } catch (error) {
    return fail(error);
  }
}

export async function convertDelayAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    convertDelay(session, claimId);
    refresh(claimId, String(formData.get("projectId") ?? ""));
    revalidatePath("/change-events", "layout");
    return { ok: "Converted" };
  } catch (error) {
    return fail(error);
  }
}

export async function waiveDelayAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    waiveDelay(session, claimId);
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Waived" };
  } catch (error) {
    return fail(error);
  }
}

export async function voidDelayAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    voidDelay(session, claimId, String(formData.get("reason") ?? ""));
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Voided" };
  } catch (error) {
    return fail(error);
  }
}

export async function copyDelayLinkAction(claimId: string): Promise<void> {
  const session = await requireSession();
  try {
    copyDelayLink(session, claimId);
    refresh(claimId);
  } catch {
    return;
  }
}

export async function markDelaySharedAction(claimId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markDelayShared(session, claimId);
    refresh(claimId, String(formData.get("projectId") ?? ""));
    return { ok: "Shared" };
  } catch (error) {
    return fail(error);
  }
}
