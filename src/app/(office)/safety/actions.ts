"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import {
  completeTalk,
  createIncident,
  linkCheckPunch,
  linkCheckTodo,
  runChecklist,
  scheduleTalk,
  updateIncident,
  voidIncident,
  type PhotoUpload,
} from "@/lib/services/safety";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

async function photosNamed(formData: FormData, prefix: string) {
  const uploads = new Map<string, PhotoUpload>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(prefix) || !(value instanceof File) || value.size === 0) continue;
    uploads.set(key.slice(prefix.length), { filename: value.name || "photo.jpg", bytes: Buffer.from(await value.arrayBuffer()) });
  }
  return uploads;
}

async function manyPhotos(formData: FormData) {
  const files = formData.getAll("photo").filter((file): file is File => file instanceof File && file.size > 0);
  const photos: PhotoUpload[] = [];
  for (const file of files) photos.push({ filename: file.name || "photo.jpg", bytes: Buffer.from(await file.arrayBuffer()) });
  return photos;
}

export async function scheduleTalkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") || "");
  try {
    scheduleTalk(session, {
      projectId,
      topicId: String(formData.get("topicId") || ""),
      scheduledOn: String(formData.get("scheduledOn") || ""),
      leaderUserId: String(formData.get("leaderUserId") || ""),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/safety");
  revalidatePath(`/projects/${projectId}/safety`);
  redirect(`/projects/${projectId}/safety`);
}

export async function completeTalkAction(talkId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") || "");
  const attendees = [];
  for (const userId of formData.getAll("user").map(String)) {
    const drawn = String(formData.get(`sign_${userId}`) || "");
    if (!drawn) continue;
    attendees.push({
      userId,
      visitorName: "",
      typedName: String(formData.get(`typed_${userId}`) || ""),
      drawnDataUrl: drawn,
    });
  }
  const visitorName = String(formData.get("visitorName") || "");
  const visitorSign = String(formData.get("sign_visitor") || "");
  if (visitorName && visitorSign) {
    attendees.push({ userId: "", visitorName, typedName: visitorName, drawnDataUrl: visitorSign });
  }
  try {
    completeTalk(session, talkId, { attendees });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/safety");
  revalidatePath(`/projects/${projectId}/safety`);
  redirect(`/projects/${projectId}/safety/talks/${talkId}`);
}

export async function runChecklistAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") || "");
  const templateId = String(formData.get("templateId") || "");
  const photos = await photosNamed(formData, "photo_");
  const items = formData
    .getAll("item")
    .map(String)
    .map((templateItemId) => ({
      templateItemId,
      result: String(formData.get(`result_${templateItemId}`) || ""),
      photo: photos.get(templateItemId) ?? null,
    }));
  try {
    runChecklist(session, { projectId, templateId, items });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/safety");
  revalidatePath(`/projects/${projectId}/safety`);
  redirect(`/projects/${projectId}/safety`);
}

export async function linkCheckTodoAction(itemId: string, formData: FormData) {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") || "");
  linkCheckTodo(session, itemId);
  revalidatePath(`/projects/${projectId}/safety`);
  revalidatePath("/todos");
}

export async function linkCheckPunchAction(itemId: string, formData: FormData) {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") || "");
  linkCheckPunch(session, itemId);
  revalidatePath(`/projects/${projectId}/safety`);
  revalidatePath(`/projects/${projectId}`);
}

export async function createIncidentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") || "");
  const people = String(formData.get("people") || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const actionTitle = String(formData.get("actionTitle") || "").trim();
  const assigneeUserId = String(formData.get("assigneeUserId") || "");
  let incidentId = "";
  try {
    incidentId = createIncident(session, {
      projectId,
      equipmentId: String(formData.get("equipmentId") || "") || null,
      kind: String(formData.get("kind") || ""),
      occurredAt: String(formData.get("occurredAt") || ""),
      description: String(formData.get("description") || ""),
      factors: String(formData.get("factors") || ""),
      people,
      actions: actionTitle ? [{ title: actionTitle, assigneeUserId }] : [],
      photos: await manyPhotos(formData),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/safety");
  revalidatePath(`/projects/${projectId}/safety`);
  revalidatePath("/equipment");
  redirect(`/safety/incidents/${incidentId}`);
}

export async function updateIncidentAction(incidentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    updateIncident(session, incidentId, {
      description: String(formData.get("description") || ""),
      factors: String(formData.get("factors") || ""),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/safety/incidents/${incidentId}`);
  redirect(`/safety/incidents/${incidentId}`);
}

export async function voidIncidentAction(incidentId: string) {
  const session = await requireSession();
  voidIncident(session, incidentId);
  revalidatePath("/safety");
  revalidatePath(`/safety/incidents/${incidentId}`);
}
