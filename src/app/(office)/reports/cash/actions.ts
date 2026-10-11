"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/money";
import { ServiceError } from "@/lib/services/errors";
import { saveCashSettings } from "@/lib/services/cash";

export async function saveCashSettingsAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const opening = parseMoneyToCents(String(formData.get("opening") ?? ""));
  const low = parseMoneyToCents(String(formData.get("low") ?? ""));
  if (opening == null || low == null) return { error: "Enter amounts." };
  const contactId = String(formData.get("contactId") ?? "");
  const rawLate = String(formData.get("daysLate") ?? "").trim();
  const daysLate = rawLate === "" ? null : Number(rawLate);
  try {
    saveCashSettings(session, { openingCents: opening, lowCents: low, contactId, daysLate });
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Could not save." };
  }
  revalidatePath("/reports/cash");
  revalidatePath("/");
  return { ok: "Saved" };
}
