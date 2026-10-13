"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { bookPublic } from "@/lib/services/booking";
import { ServiceError } from "@/lib/services/errors";

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

export async function bookAction(formToken: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const answers: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("a_")) answers[key.slice(2)] = String(value);
    }
    const placed = bookPublic({
      token: formToken,
      itemId: String(formData.get("itemId") || ""),
      day: String(formData.get("day") || ""),
      startMin: Number(formData.get("startMin")),
      name: String(formData.get("name") || ""),
      phone: String(formData.get("phone") || ""),
      email: String(formData.get("email") || ""),
      answers,
    });
    redirect(`/book/${formToken}?booked=1&day=${placed.day}&at=${encodeURIComponent(placed.start)}&who=${encodeURIComponent(placed.assigneeName)}`);
  } catch (error) {
    return failure(error);
  }
}
