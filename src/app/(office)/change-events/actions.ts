"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/money";
import { ServiceError } from "@/lib/services/errors";
import {
  addChangeEventCode,
  askChangeQuote,
  attachChangeEventFile,
  chooseChangeQuote,
  convertChangeEvent,
  copyChangeQuote,
  createChangeEvent,
  markChangeReady,
  markChangeRequested,
  saveChangeEvent,
  submitChangeQuote,
  voidChangeEvent,
} from "@/lib/services/change-events";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function cents(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return 0;
  const parsed = parseMoneyToCents(raw);
  if (parsed == null) throw new ServiceError("Enter an amount.");
  return parsed;
}

function days(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return 0;
  if (!/^\d{1,4}$/.test(raw)) throw new ServiceError("Enter days.");
  return Number(raw);
}

function refresh(eventId?: string, projectId?: string) {
  revalidatePath("/change-events", "layout");
  revalidatePath("/");
  if (eventId) revalidatePath(`/change-events/${eventId}`);
  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/changes`);
  }
}

export async function createChangeEventAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  let eventId = "";
  try {
    eventId = createChangeEvent(session, projectId, {
      title: String(formData.get("title") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      costCode: String(formData.get("costCode") ?? ""),
      romCostCents: cents(formData, "romCost"),
      romPriceCents: cents(formData, "romPrice"),
      scheduleDays: days(formData, "scheduleDays"),
      sourceKind: String(formData.get("sourceKind") ?? ""),
      sourceId: String(formData.get("sourceId") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  refresh(eventId, projectId);
  redirect(`/change-events/${eventId}`);
}

export async function saveChangeEventAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    const codes = [...formData.keys()]
      .filter((key) => key.startsWith("cost_"))
      .map((key) => {
        const id = key.slice(5);
        return { id, romCostCents: cents(formData, key), romPriceCents: cents(formData, `price_${id}`) };
      });
    saveChangeEvent(session, eventId, {
      title: String(formData.get("title") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      scheduleDays: days(formData, "scheduleDays"),
      codes,
    });
    refresh(eventId, String(formData.get("projectId") ?? ""));
    return { ok: "Saved" };
  } catch (error) {
    return fail(error);
  }
}

export async function addChangeCodeAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    addChangeEventCode(session, eventId, String(formData.get("costCode") ?? ""), cents(formData, "romCost"), cents(formData, "romPrice"));
    refresh(eventId, String(formData.get("projectId") ?? ""));
    return { ok: "Added" };
  } catch (error) {
    return fail(error);
  }
}

export async function attachChangeFileAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    attachChangeEventFile(session, eventId, String(formData.get("documentId") ?? ""));
    refresh(eventId);
    return { ok: "Attached" };
  } catch (error) {
    return fail(error);
  }
}

export async function askChangeQuoteAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    askChangeQuote(session, eventId, String(formData.get("contactId") ?? ""), String(formData.get("dueOn") ?? ""));
    refresh(eventId);
    return { ok: "Asked" };
  } catch (error) {
    return fail(error);
  }
}

export async function copyChangeQuoteAction(quoteId: string): Promise<void> {
  const session = await requireSession();
  try {
    copyChangeQuote(session, quoteId);
    refresh();
  } catch {
    return;
  }
}

export async function markChangeRequestedAction(quoteId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markChangeRequested(session, quoteId);
    refresh();
    return { ok: "Requested" };
  } catch (error) {
    return fail(error);
  }
}

export async function chooseChangeQuoteAction(quoteId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    chooseChangeQuote(session, quoteId);
    refresh();
    return { ok: "Chosen" };
  } catch (error) {
    return fail(error);
  }
}

export async function markChangeReadyAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markChangeReady(session, eventId);
    refresh(eventId, String(formData.get("projectId") ?? ""));
    return { ok: "Ready" };
  } catch (error) {
    return fail(error);
  }
}

export async function convertChangeEventAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    convertChangeEvent(session, eventId);
    refresh(eventId, String(formData.get("projectId") ?? ""));
    return { ok: "Converted" };
  } catch (error) {
    return fail(error);
  }
}

export async function voidChangeEventAction(eventId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    voidChangeEvent(session, eventId, String(formData.get("reason") ?? ""));
    refresh(eventId, String(formData.get("projectId") ?? ""));
    return { ok: "Void" };
  } catch (error) {
    return fail(error);
  }
}

export async function submitChangeQuoteAction(token: string, quoteId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const amount = parseMoneyToCents(String(formData.get("amount") ?? ""));
    if (amount == null || amount <= 0) throw new ServiceError("Enter an amount.");
    const rawDays = String(formData.get("days") ?? "").trim();
    if (!/^\d{1,4}$/.test(rawDays)) throw new ServiceError("Enter days.");
    submitChangeQuote({ token, quoteId, amountCents: amount, days: Number(rawDays), note: String(formData.get("note") ?? "") });
    revalidatePath(`/v/${token}`);
    return { ok: "Priced" };
  } catch (error) {
    return fail(error);
  }
}
