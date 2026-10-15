"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { markNecRequested, saveVendorTax } from "@/lib/services/nec1099";

export async function markNecRequestedAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const contactId = String(formData.get("contactId") ?? "");
  const year = Number(formData.get("year") ?? "");
  try {
    markNecRequested(session, contactId, year);
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Could not save." };
  }
  revalidatePath("/reports/nec");
  revalidatePath("/");
  revalidatePath("/inbox");
  return { ok: "Requested" };
}

export async function saveVendorTaxAction(contactId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    saveVendorTax(session, contactId, {
      legalName: String(formData.get("legalName") ?? ""),
      taxClass: String(formData.get("taxClass") ?? ""),
      exempt: formData.get("exempt") === "on",
      tin: String(formData.get("tin") ?? ""),
    });
  } catch (error) {
    return { error: error instanceof ServiceError ? error.message : "Could not save." };
  }
  revalidatePath("/reports/nec");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: "Saved" };
}
