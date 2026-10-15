"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { markLienSent, saveLienJob, saveLienRule } from "@/lib/services/liens";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

export async function saveLienRuleAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveLienRule(session, {
      state: String(formData.get("state") ?? ""),
      role: String(formData.get("role") ?? ""),
      prelimKind: String(formData.get("prelimKind") ?? ""),
      prelimDays: String(formData.get("prelimDays") ?? ""),
      prelimMonths: String(formData.get("prelimMonths") ?? ""),
      prelimDay: String(formData.get("prelimDay") ?? ""),
      noiKind: String(formData.get("noiKind") ?? ""),
      noiDays: String(formData.get("noiDays") ?? ""),
      fileKind: String(formData.get("fileKind") ?? ""),
      fileAnchor: String(formData.get("fileAnchor") ?? ""),
      fileDays: String(formData.get("fileDays") ?? ""),
      fileMonths: String(formData.get("fileMonths") ?? ""),
      fileDay: String(formData.get("fileDay") ?? ""),
      enforceKind: String(formData.get("enforceKind") ?? ""),
      enforceFrom: String(formData.get("enforceFrom") ?? ""),
      enforceDays: String(formData.get("enforceDays") ?? ""),
      prelimLapses: formData.get("prelimLapses") === "1",
      citation: String(formData.get("citation") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/settings/liens");
  revalidatePath("/liens");
  revalidatePath("/");
  return { ok: "Saved." };
}

export async function saveLienJobAction(projectId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveLienJob(session, projectId, {
      state: String(formData.get("state") ?? ""),
      role: String(formData.get("role") ?? ""),
      first: String(formData.get("first") ?? ""),
      last: String(formData.get("last") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/liens");
  revalidatePath("/");
  return { ok: "Saved." };
}

export async function markLienSentAction(projectId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const photo = formData.get("photo");
  const upload = photo instanceof File && photo.size > 0 ? { filename: photo.name || "notice", bytes: Buffer.from(await photo.arrayBuffer()) } : null;
  try {
    markLienSent(session, projectId, {
      kind: String(formData.get("kind") ?? ""),
      sentOn: String(formData.get("sentOn") ?? ""),
      method: String(formData.get("method") ?? ""),
      upload,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/liens");
  revalidatePath("/");
  return { ok: "Saved." };
}
