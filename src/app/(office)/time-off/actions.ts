"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { approveTimeOff, cancelTimeOff, declineTimeOff, requestTimeOff, setPtoAllowance } from "@/lib/services/time-off";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function refresh() {
  revalidatePath("/time-off");
  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/schedule/workload");
  revalidatePath("/dispatch");
  revalidatePath("/time");
}

export async function requestTimeOffAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    requestTimeOff(session, {
      startOn: String(formData.get("startOn") ?? ""),
      endOn: String(formData.get("endOn") ?? ""),
      hours: String(formData.get("hours") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Requested." };
}

export async function cancelTimeOffAction(requestId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    cancelTimeOff(session, requestId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Cancelled." };
}

export async function approveTimeOffAction(requestId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    approveTimeOff(session, requestId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Approved." };
}

export async function declineTimeOffAction(requestId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    declineTimeOff(session, requestId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Declined." };
}

export async function setPtoAllowanceAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    setPtoAllowance(session, String(formData.get("userId") ?? ""), String(formData.get("hours") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { ok: "Saved." };
}
