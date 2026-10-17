"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { markPortalObservation } from "@/lib/services/vendor-portal";
import {
  addObservationNote,
  addObservationPhoto,
  closeObservation,
  copyObservationLink,
  createObservation,
  createObservationBackcharge,
  linkObservationFromCheck,
  linkObservationFromInspection,
  markObservationReady,
  markObservationShared,
  notAcceptObservation,
  openObservation,
  saveObservation,
  voidObservation,
  type ObservationInput,
  type PhotoUpload,
} from "@/lib/services/observations";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function inputFrom(formData: FormData, projectId?: string): ObservationInput {
  return {
    projectId: projectId || text(formData, "projectId"),
    title: text(formData, "title"),
    type: text(formData, "type") || "quality",
    priority: text(formData, "priority") || "medium",
    hazard: text(formData, "hazard"),
    location: text(formData, "location"),
    costCode: text(formData, "costCode"),
    trade: text(formData, "trade"),
    assigneeUserId: text(formData, "assigneeUserId"),
    assigneeContactId: text(formData, "assigneeContactId"),
    dueDate: text(formData, "dueDate"),
    description: text(formData, "description"),
    planPinId: text(formData, "planPinId"),
    scheduleItemId: text(formData, "scheduleItemId"),
    inspectionId: text(formData, "inspectionId"),
    safetyCheckItemId: text(formData, "safetyCheckItemId"),
  };
}

async function photoOf(formData: FormData): Promise<PhotoUpload | null> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return { filename: file.name || "photo.png", bytes: Buffer.from(await file.arrayBuffer()) };
}

export async function createObservationAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let observationId = "";
  try {
    observationId = createObservation(session, inputFrom(formData)).id;
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/observations");
  redirect(`/observations/${observationId}`);
}

export async function createFieldObservationAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    createObservation(session, inputFrom(formData));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/");
  return { ok: "Open" };
}

export async function saveObservationAction(observationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveObservation(session, observationId, inputFrom(formData));
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Saved" };
}

export async function openObservationAction(observationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    openObservation(session, observationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Open" };
}

export async function readyObservationAction(observationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markObservationReady(session, observationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  revalidatePath("/");
  return { ok: "Ready for review" };
}

export async function notAcceptObservationAction(observationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    notAcceptObservation(session, observationId, text(formData, "note"));
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Open" };
}

export async function closeObservationAction(observationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    closeObservation(session, observationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Closed" };
}

export async function voidObservationAction(observationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    voidObservation(session, observationId, text(formData, "reason"));
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Void" };
}

export async function noteObservationAction(observationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addObservationNote(session, observationId, text(formData, "note"));
    const photo = await photoOf(formData);
    if (photo) addObservationPhoto(session, observationId, photo);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Saved" };
}

export async function backchargeObservationAction(observationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    createObservationBackcharge(session, observationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  revalidatePath("/vendor-credits");
  return { ok: "Draft" };
}

export async function copyObservationLinkAction(observationId: string): Promise<void> {
  const session = await requireSession();
  copyObservationLink(session, observationId);
  revalidatePath(`/observations/${observationId}`);
}

export async function shareObservationAction(observationId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markObservationShared(session, observationId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/observations/${observationId}`);
  return { ok: "Shared" };
}

export async function markPortalObservationAction(token: string, observationId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const photo = await photoOf(formData);
    markPortalObservation({ token, ip: "portal", observationId, note: text(formData, "note"), photo });
  } catch (error) {
    return fail(error);
  }
  return { ok: "Ready for review" };
}

export async function linkCheckObservationAction(itemId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = text(formData, "projectId");
  try {
    linkObservationFromCheck(session, itemId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/projects/${projectId}/safety`);
  return { ok: "Open" };
}

export async function linkInspectionObservationAction(inspectionId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = text(formData, "projectId");
  try {
    linkObservationFromInspection(session, inspectionId);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/projects/${projectId}/permits`);
  return { ok: "Open" };
}
