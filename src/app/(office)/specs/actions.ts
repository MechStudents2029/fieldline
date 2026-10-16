"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import {
  addSpecLine,
  attachSpecFile,
  createFromBudget,
  keepSpecLine,
  markSpecSent,
  moveSpecLine,
  publishSpec,
  pullSpecLines,
  refreshSpecLine,
  reviseSpec,
  saveSpecLine,
  updateSpec,
} from "@/lib/services/job-specs";
import { ServiceError } from "@/lib/services/errors";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function refresh(specId?: string, projectId?: string) {
  revalidatePath("/specs", "layout");
  revalidatePath("/");
  if (specId) revalidatePath(`/specs/${specId}`);
  if (projectId) revalidatePath(`/projects/${projectId}/specs`);
  revalidatePath("/projects", "layout");
}

async function readFile(formData: FormData) {
  const value = formData.get("file");
  if (!(value instanceof File) || value.size === 0) return null;
  return { filename: value.name || "file", bytes: Buffer.from(await value.arrayBuffer()) };
}

export async function createSpecFromBudgetAction(projectId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let specId = "";
  try {
    specId = createFromBudget(session, projectId, String(formData.get("title") ?? "")).id;
  } catch (error) {
    return fail(error);
  }
  refresh(specId, projectId);
  redirect(`/specs/${specId}`);
}

export async function updateSpecAction(specId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    updateSpec(session, specId, { title: String(formData.get("title") ?? ""), dueOn: String(formData.get("dueOn") ?? "") });
  } catch (error) {
    return fail(error);
  }
  refresh(specId);
  return { ok: "Saved." };
}

export async function saveSpecLineAction(lineId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveSpecLine(session, lineId, {
      description: String(formData.get("description") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      groupLabel: String(formData.get("groupLabel") ?? ""),
      costCode: String(formData.get("costCode") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function moveSpecLineAction(lineId: string, direction: "up" | "down", _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    moveSpecLine(session, lineId, direction);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function addSpecLineAction(specId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addSpecLine(session, specId, {
      description: String(formData.get("description") ?? ""),
      costCode: String(formData.get("costCode") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh(specId);
  return { ok: "Saved." };
}

export async function attachSpecFileAction(lineId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    const file = await readFile(formData);
    if (!file) return { error: "Choose a file." };
    attachSpecFile(session, lineId, file);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function publishSpecAction(specId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    publishSpec(session, specId);
  } catch (error) {
    return fail(error);
  }
  refresh(specId);
  return { ok: "Published." };
}

export async function reviseSpecAction(specId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let nextId = "";
  try {
    nextId = reviseSpec(session, specId).id;
  } catch (error) {
    return fail(error);
  }
  refresh(nextId);
  redirect(`/specs/${nextId}`);
}

export async function markSpecSentAction(specId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markSpecSent(session, specId);
  } catch (error) {
    return fail(error);
  }
  refresh(specId);
  return { ok: "Sent." };
}

export async function refreshSpecLineAction(lineId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    refreshSpecLine(session, lineId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function keepSpecLineAction(lineId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    keepSpecLine(session, lineId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}

export async function pullSpecLinesAction(specId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    pullSpecLines(session, specId);
  } catch (error) {
    return fail(error);
  }
  refresh(specId);
  return { ok: "Saved." };
}
