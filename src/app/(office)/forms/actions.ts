"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import {
  archiveFormTemplate,
  attachForm,
  createFormTemplate,
  markFormLinkSent,
  reviewForm,
  submitPublicForm,
  submitSignedForm,
  updateFormTemplate,
} from "@/lib/services/forms";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function readTemplate(formData: FormData) {
  const fields = [];
  for (let index = 0; index < 12; index += 1) {
    const label = String(formData.get(`field_label_${index}`) ?? "");
    if (!label.trim()) continue;
    fields.push({
      id: String(formData.get(`field_id_${index}`) ?? ""),
      label,
      type: String(formData.get(`field_type_${index}`) ?? "text"),
      required: formData.get(`field_required_${index}`) === "1",
      options: String(formData.get(`field_options_${index}`) ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    audiences: formData.getAll("audience").map(String),
    fields,
  };
}

async function readFill(formData: FormData) {
  const texts: Record<string, string | null> = {};
  const files: Record<string, { filename: string; bytes: Buffer }> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("file_") && value instanceof File && value.size > 0) {
      files[key.slice(5)] = { filename: value.name || "file", bytes: Buffer.from(await value.arrayBuffer()) };
    } else if (key.startsWith("f_")) {
      texts[key.slice(2)] = String(value);
    }
  }
  return { texts, files };
}

function refresh(templateId?: string, submissionId?: string) {
  revalidatePath("/forms");
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath("/settings/forms");
  if (templateId) revalidatePath(`/settings/forms/${templateId}`);
  if (submissionId) revalidatePath(`/forms/${submissionId}`);
}

export async function createFormTemplateAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let templateId = "";
  try {
    templateId = createFormTemplate(session, readTemplate(formData)).id;
  } catch (error) {
    return fail(error);
  }
  refresh(templateId);
  redirect(`/settings/forms/${templateId}`);
}

export async function updateFormTemplateAction(templateId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    updateFormTemplate(session, templateId, readTemplate(formData));
  } catch (error) {
    return fail(error);
  }
  refresh(templateId);
  return { ok: "Saved." };
}

export async function archiveFormTemplateAction(templateId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    archiveFormTemplate(session, templateId);
  } catch (error) {
    return fail(error);
  }
  refresh(templateId);
  return { ok: "Saved." };
}

export async function markFormLinkSentAction(templateId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markFormLinkSent(session, templateId);
  } catch (error) {
    return fail(error);
  }
  refresh(templateId);
  return { ok: "Saved." };
}

export async function reviewFormAction(submissionId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    reviewForm(session, submissionId);
  } catch (error) {
    return fail(error);
  }
  refresh(undefined, submissionId);
  return { ok: "Saved." };
}

export async function attachFormAction(submissionId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    attachForm(session, submissionId, String(formData.get("projectId") ?? ""), String(formData.get("contactId") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(undefined, submissionId);
  return { ok: "Saved." };
}

export async function submitPublicFormAction(formToken: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const headerList = await headers();
    const fill = await readFill(formData);
    const result = submitPublicForm({
      token: formToken,
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
      startedAt: String(formData.get("startedAt") || ""),
      companyUrl: String(formData.get("hp_field") || ""),
      texts: fill.texts,
      files: fill.files,
    });
    if ("id" in result) refresh(undefined, result.id);
  } catch (error) {
    return fail(error);
  }
  return { ok: "Received." };
}

export async function submitSignedFormAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    const fill = await readFill(formData);
    const submissionId = submitSignedForm(session, templateId, fill);
    refresh(undefined, submissionId);
  } catch (error) {
    return fail(error);
  }
  return { ok: "Received." };
}
