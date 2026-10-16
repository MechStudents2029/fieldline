"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import {
  addItem,
  addSection,
  attachDoc,
  copyHandover,
  markDelivered,
  markReady,
  moveItem,
  moveSection,
  publishHandover,
  removeItem,
  removeSection,
  saveItem,
  startHandover,
} from "@/lib/services/handover";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function refresh(packageId?: string, projectId?: string) {
  revalidatePath("/handover");
  revalidatePath("/");
  if (packageId) {
    revalidatePath(`/handover/${packageId}`);
    revalidatePath(`/handover/${packageId}/print`);
  }
  if (projectId) revalidatePath(`/projects/${projectId}/handover`);
}

export async function startHandoverAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  let packageId = "";
  try {
    packageId = startHandover(session, projectId);
  } catch (error) {
    return fail(error);
  }
  refresh(packageId, projectId);
  redirect(`/handover/${packageId}`);
}

export async function addSectionAction(packageId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addSection(session, packageId, String(formData.get("title") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(packageId);
  return { ok: "Added." };
}

export async function moveSectionAction(sectionId: string, direction: "up" | "down", _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    moveSection(session, sectionId, direction);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function removeSectionAction(sectionId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    removeSection(session, sectionId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Removed." };
}

export async function addItemAction(sectionId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addItem(session, sectionId, String(formData.get("title") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Added." };
}

export async function saveItemAction(itemId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveItem(session, itemId, {
      title: String(formData.get("title") ?? ""),
      manufacturer: String(formData.get("manufacturer") ?? ""),
      model: String(formData.get("model") ?? ""),
      serial: String(formData.get("serial") ?? ""),
      finish: String(formData.get("finish") ?? ""),
      installOn: String(formData.get("installOn") ?? ""),
      warrantyMonths: String(formData.get("warrantyMonths") ?? ""),
      intervalDays: String(formData.get("intervalDays") ?? ""),
      intervalLabel: String(formData.get("intervalLabel") ?? ""),
      vendorName: String(formData.get("vendorName") ?? ""),
      trade: String(formData.get("trade") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function attachDocAction(itemId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    attachDoc(session, itemId, String(formData.get("documentId") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function moveItemAction(itemId: string, direction: "up" | "down", _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    moveItem(session, itemId, direction);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function removeItemAction(itemId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    removeItem(session, itemId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Removed." };
}

export async function markReadyAction(packageId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markReady(session, packageId);
  } catch (error) {
    return fail(error);
  }
  refresh(packageId);
  return { ok: "Ready." };
}

export async function publishHandoverAction(packageId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    publishHandover(session, packageId);
  } catch (error) {
    return fail(error);
  }
  refresh(packageId);
  return { ok: "Published." };
}

export async function markDeliveredAction(packageId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markDelivered(session, packageId);
  } catch (error) {
    return fail(error);
  }
  refresh(packageId);
  return { ok: "Delivered." };
}

export async function copyHandoverAction(packageId: string): Promise<void> {
  const session = await requireSession();
  try {
    copyHandover(session, packageId);
  } catch {
    return;
  }
  refresh(packageId);
}
