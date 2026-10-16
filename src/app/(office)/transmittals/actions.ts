"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import {
  acknowledgeByToken,
  addTransmittalFile,
  addTransmittalNote,
  closeTransmittal,
  copyTransmittal,
  createTransmittal,
  declineTransmittalByToken,
  markTransmittalSent,
  moveTransmittalLine,
  removeTransmittalLine,
  saveTransmittal,
  setTransmittalReturn,
  voidTransmittal,
} from "@/lib/services/transmittals";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function refresh(transmittalId?: string, projectId?: string) {
  revalidatePath("/transmittals");
  revalidatePath("/");
  if (transmittalId) {
    revalidatePath(`/transmittals/${transmittalId}`);
    revalidatePath(`/transmittals/${transmittalId}/print`);
  }
  if (projectId) revalidatePath(`/projects/${projectId}/transmittals`);
}

function splitTo(value: string) {
  const index = value.indexOf(":");
  if (index < 1) return { toKind: "", toId: "" };
  return { toKind: value.slice(0, index), toId: value.slice(index + 1) };
}

function ccIds(formData: FormData) {
  return formData
    .getAll("cc")
    .map((value) => String(value))
    .filter(Boolean);
}

export async function createTransmittalAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const to = splitTo(String(formData.get("to") ?? ""));
  let transmittalId = "";
  try {
    transmittalId = createTransmittal(session, projectId, {
      subject: String(formData.get("subject") ?? ""),
      toKind: to.toKind,
      toId: to.toId,
      purpose: String(formData.get("purpose") ?? ""),
      dueOn: String(formData.get("dueOn") ?? ""),
      ccUserIds: ccIds(formData),
    });
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId, projectId);
  redirect(`/transmittals/${transmittalId}`);
}

export async function saveTransmittalAction(transmittalId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const to = splitTo(String(formData.get("to") ?? ""));
  try {
    saveTransmittal(session, transmittalId, {
      subject: String(formData.get("subject") ?? ""),
      toKind: to.toKind,
      toId: to.toId,
      purpose: String(formData.get("purpose") ?? ""),
      dueOn: String(formData.get("dueOn") ?? ""),
      ccUserIds: ccIds(formData),
    });
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId);
  return { ok: "Saved." };
}

export async function addNoteAction(transmittalId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addTransmittalNote(session, transmittalId, String(formData.get("title") ?? ""), formData.get("returnRequired") === "on");
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId);
  return { ok: "Added." };
}

export async function addFileAction(transmittalId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const source = String(formData.get("source") ?? "");
  const index = source.indexOf(":");
  try {
    addTransmittalFile(session, transmittalId, source.slice(0, index), source.slice(index + 1), formData.get("returnRequired") === "on");
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId);
  return { ok: "Added." };
}

export async function setReturnAction(lineId: string, on: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    setTransmittalReturn(session, lineId, on === "1");
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function moveLineAction(lineId: string, direction: "up" | "down", _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    moveTransmittalLine(session, lineId, direction);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function removeLineAction(lineId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    removeTransmittalLine(session, lineId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Removed." };
}

export async function copyTransmittalAction(transmittalId: string): Promise<void> {
  const session = await requireSession();
  try {
    copyTransmittal(session, transmittalId);
  } catch {
    return;
  }
  refresh(transmittalId);
}

export async function markSentAction(transmittalId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markTransmittalSent(session, transmittalId);
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId);
  redirect(`/transmittals/${transmittalId}`);
}

export async function closeTransmittalAction(transmittalId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    closeTransmittal(session, transmittalId);
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId);
  return { ok: "Closed." };
}

export async function voidTransmittalAction(transmittalId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    voidTransmittal(session, transmittalId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(transmittalId);
  return { ok: "Voided." };
}

export async function acknowledgeTransmittalAction(shareToken: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const headerList = await headers();
    const result = acknowledgeByToken({
      token: shareToken,
      name: String(formData.get("name") ?? ""),
      note: String(formData.get("note") ?? ""),
      startedAt: String(formData.get("startedAt") ?? ""),
      companyUrl: String(formData.get("hp_field") ?? ""),
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
    });
    if ("dropped" in result) return { ok: "Received." };
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/t/${shareToken}`);
  revalidatePath("/transmittals");
  redirect(`/t/${shareToken}`);
}

export async function declineTransmittalAction(shareToken: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const headerList = await headers();
    const result = declineTransmittalByToken({
      token: shareToken,
      reason: String(formData.get("reason") ?? ""),
      startedAt: String(formData.get("startedAt") ?? ""),
      companyUrl: String(formData.get("hp_field") ?? ""),
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
    });
    if ("dropped" in result) return { ok: "Received." };
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/t/${shareToken}`);
  revalidatePath("/transmittals");
  redirect(`/t/${shareToken}`);
}
