"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { archiveField, createField, moveField, restoreField, saveRecordFields, updateField } from "@/lib/services/custom-fields";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function flag(formData: FormData, name: string) {
  return formData.get(name) === "1";
}

function optionsOf(formData: FormData) {
  return String(formData.get("options") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    createField(session, {
      recordType: String(formData.get("recordType") || ""),
      label: String(formData.get("label") || ""),
      fieldType: String(formData.get("fieldType") || ""),
      options: optionsOf(formData),
      defaultValue: String(formData.get("defaultValue") || ""),
      required: flag(formData, "required"),
      hint: String(formData.get("hint") || ""),
      office: flag(formData, "office"),
      field: flag(formData, "field"),
      vendor: flag(formData, "vendor"),
      client: flag(formData, "client"),
      showOnDocuments: flag(formData, "showOnDocuments"),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/settings/fields");
  redirect("/settings/fields");
}

export async function updateFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    updateField(session, String(formData.get("id") || ""), {
      label: String(formData.get("label") || ""),
      fieldType: String(formData.get("fieldType") || ""),
      options: optionsOf(formData),
      defaultValue: String(formData.get("defaultValue") || ""),
      required: flag(formData, "required"),
      hint: String(formData.get("hint") || ""),
      office: flag(formData, "office"),
      field: flag(formData, "field"),
      vendor: flag(formData, "vendor"),
      client: flag(formData, "client"),
      showOnDocuments: flag(formData, "showOnDocuments"),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/settings/fields");
  redirect("/settings/fields");
}

export async function archiveFieldAction(formData: FormData) {
  const session = await requireSession();
  archiveField(session, String(formData.get("id") || ""));
  revalidatePath("/settings/fields");
}

export async function restoreFieldAction(formData: FormData) {
  const session = await requireSession();
  restoreField(session, String(formData.get("id") || ""));
  revalidatePath("/settings/fields");
}

export async function moveFieldAction(formData: FormData) {
  const session = await requireSession();
  const direction = formData.get("direction") === "1" ? 1 : -1;
  moveField(session, String(formData.get("id") || ""), direction);
  revalidatePath("/settings/fields");
}

export async function saveFieldsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const recordType = String(formData.get("recordType") || "");
  const recordId = String(formData.get("recordId") || "");
  const returnTo = String(formData.get("returnTo") || "/");
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "recordType" || key === "recordId" || key === "returnTo") continue;
    const text = String(value);
    const current = values[key];
    if (current == null) values[key] = text;
    else if (Array.isArray(current)) current.push(text);
    else values[key] = [current, text];
  }
  try {
    saveRecordFields(session, recordType, recordId, values);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(returnTo);
  redirect(returnTo);
}
