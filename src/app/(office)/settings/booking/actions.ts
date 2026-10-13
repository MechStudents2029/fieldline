"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { addBookingOff, saveBookableService, saveBookableTech, saveBookingPrefs } from "@/lib/services/booking";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

function days(formData: FormData): number[] {
  return formData.getAll("day").map((value) => Number(value)).filter((value) => Number.isInteger(value));
}

export async function saveBookingPrefsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    saveBookingPrefs(actor, {
      enabled: formData.get("enabled") === "on",
      earliestHours: Number(formData.get("earliest")),
      intervalMin: Number(formData.get("interval")),
      bufferMin: Number(formData.get("buffer")),
      start: String(formData.get("start") || ""),
      end: String(formData.get("end") || ""),
      days: days(formData),
      questions: String(formData.get("questions") || ""),
    });
    revalidatePath("/settings/booking");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    saveBookableService(actor, {
      itemId: String(formData.get("itemId") || ""),
      bookable: formData.get("bookable") !== "0",
      durationMin: Number(formData.get("duration")),
      price: String(formData.get("price") || ""),
      staff: formData.getAll("staff").map(String),
    });
    revalidatePath("/settings/booking");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveTechAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    saveBookableTech(actor, {
      userId: String(formData.get("userId") || ""),
      bookable: formData.get("bookable") === "on",
      start: String(formData.get("start") || ""),
      end: String(formData.get("end") || ""),
    });
    revalidatePath("/settings/booking");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function addOffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireSession();
    addBookingOff(actor, {
      userId: String(formData.get("userId") || ""),
      start: String(formData.get("start") || ""),
      end: String(formData.get("end") || ""),
    });
    revalidatePath("/settings/booking");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}
