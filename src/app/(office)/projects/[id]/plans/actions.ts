"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { deleteTakeoff, reviewTakeoffs, savePlanScale, saveTakeoff, type TakeoffInput } from "@/lib/services/takeoff";

async function actor() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

function failure(error: unknown): { error: string } {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function refresh(projectId: string, jobFileId: string, estimateId?: string | null) {
  revalidatePath(`/projects/${projectId}/plans/${jobFileId}`);
  if (estimateId) revalidatePath(`/estimates/${estimateId}`);
}

export async function savePlanScaleAction(input: {
  projectId: string;
  jobFileId: string;
  mode: "segment" | "preset";
  preset?: string | null;
  ax?: number | null;
  ay?: number | null;
  bx?: number | null;
  by?: number | null;
  length?: string | null;
  paperWidthInches?: number | null;
  aspectBps?: number | null;
}): Promise<{ error?: string; scaleText?: string }> {
  try {
    const user = await actor();
    const saved = savePlanScale(user, input);
    refresh(input.projectId, input.jobFileId);
    return { scaleText: saved.scaleText };
  } catch (error) {
    return failure(error);
  }
}

export async function saveTakeoffAction(input: TakeoffInput): Promise<{ error?: string; qtyMilli?: number; unit?: string; frozen?: boolean }> {
  try {
    const user = await actor();
    const saved = saveTakeoff(user, input);
    refresh(input.projectId, input.jobFileId, input.estimateId);
    return { qtyMilli: saved.qtyMilli, unit: saved.unit, frozen: saved.frozen };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteTakeoffAction(input: { projectId: string; jobFileId: string; id: string }): Promise<{ error?: string }> {
  try {
    const user = await actor();
    deleteTakeoff(user, input);
    refresh(input.projectId, input.jobFileId);
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function reviewTakeoffsAction(input: { projectId: string; jobFileId: string }): Promise<{ error?: string }> {
  try {
    const user = await actor();
    reviewTakeoffs(user, input);
    refresh(input.projectId, input.jobFileId);
    return {};
  } catch (error) {
    return failure(error);
  }
}
