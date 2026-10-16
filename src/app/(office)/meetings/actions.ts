"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import {
  addAction,
  addItem,
  approveMinutes,
  createActionTodo,
  createMeeting,
  followUpMeeting,
  markDistributed,
  reviseMeeting,
  saveItem,
  setActionStatus,
  startMinutes,
} from "@/lib/services/meetings";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function refresh(meetingId?: string, projectId?: string) {
  revalidatePath("/meetings");
  revalidatePath("/");
  if (meetingId) revalidatePath(`/meetings/${meetingId}`);
  if (projectId) revalidatePath(`/projects/${projectId}/meetings`);
}

export async function createMeetingAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  let meetingId = "";
  try {
    meetingId = createMeeting(session, {
      projectId,
      kind: String(formData.get("kind") ?? ""),
      title: String(formData.get("title") ?? ""),
      meetOn: String(formData.get("meetOn") ?? ""),
      startTime: String(formData.get("startTime") ?? ""),
      location: String(formData.get("location") ?? ""),
      userId: String(formData.get("userId") ?? ""),
      vendorId: String(formData.get("vendorId") ?? ""),
      clientId: String(formData.get("clientId") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId, projectId);
  redirect(`/meetings/${meetingId}`);
}

export async function addItemAction(meetingId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addItem(session, meetingId, { title: String(formData.get("title") ?? ""), link: String(formData.get("link") ?? "") });
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId);
  return { ok: "Added." };
}

export async function saveItemAction(itemId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveItem(session, itemId, {
      notes: String(formData.get("notes") ?? ""),
      decision: String(formData.get("decision") ?? ""),
      itemStatus: String(formData.get("itemStatus") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function addActionItem(itemId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addAction(session, itemId, {
      title: String(formData.get("title") ?? ""),
      assignee: String(formData.get("assignee") ?? ""),
      dueOn: String(formData.get("dueOn") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Added." };
}

export async function setActionStatusAction(actionId: string, status: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    setActionStatus(session, actionId, status);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: status === "done" ? "Done." : "Open." };
}

export async function createActionTodoAction(actionId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    createActionTodo(session, actionId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  revalidatePath("/todos");
  return { ok: "To-do." };
}

export async function startMinutesAction(meetingId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    startMinutes(session, meetingId);
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId);
  return { ok: "Minutes." };
}

export async function approveMinutesAction(meetingId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    approveMinutes(session, meetingId);
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId);
  return { ok: "Approved." };
}

export async function reviseMeetingAction(meetingId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let nextId = "";
  try {
    nextId = reviseMeeting(session, meetingId);
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId);
  redirect(`/meetings/${nextId}`);
}

export async function followUpAction(meetingId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let nextId = "";
  try {
    nextId = followUpMeeting(session, meetingId, String(formData.get("meetOn") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId);
  redirect(`/meetings/${nextId}`);
}

export async function markDistributedAction(meetingId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markDistributed(session, meetingId);
  } catch (error) {
    return fail(error);
  }
  refresh(meetingId);
  return { ok: "Recorded." };
}
