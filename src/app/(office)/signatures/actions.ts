"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import {
  createSignatureRequest,
  declineByToken,
  markSignatureSent,
  replaceTradeAgreement,
  signByToken,
  voidSignatureRequest,
} from "@/lib/services/doc-signatures";
import { ServiceError } from "@/lib/services/errors";

function fail(error: unknown): ActionState {
  return { error: error instanceof ServiceError ? error.message : "Could not save." };
}

function readSigners(formData: FormData) {
  const signers = [];
  for (const key of ["signer", "signer_2"]) {
    const value = String(formData.get(key) ?? "");
    if (!value.includes(":")) continue;
    const [role, id] = value.split(":");
    if (role === "team") signers.push({ role, userId: id });
    else signers.push({ role, contactId: id });
  }
  return signers;
}

async function readFile(formData: FormData) {
  const value = formData.get("file");
  if (!(value instanceof File) || value.size === 0) return null;
  return { filename: value.name || "file", bytes: Buffer.from(await value.arrayBuffer()) };
}

function refresh(requestId?: string) {
  revalidatePath("/signatures");
  revalidatePath("/");
  revalidatePath("/contacts");
  if (requestId) {
    revalidatePath(`/signatures/${requestId}`);
    revalidatePath(`/signatures/${requestId}/certificate`);
  }
}

export async function createSignatureRequestAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let requestId = "";
  try {
    requestId = createSignatureRequest(session, {
      title: String(formData.get("title") ?? ""),
      note: String(formData.get("note") ?? ""),
      kind: String(formData.get("kind") ?? "file"),
      projectId: String(formData.get("projectId") ?? "") || null,
      dueOn: String(formData.get("dueOn") ?? ""),
      ordered: formData.get("ordered") === "on",
      vendorContactId: String(formData.get("vendorContactId") ?? "") || null,
      signers: readSigners(formData),
      file: await readFile(formData),
    }).id;
  } catch (error) {
    return fail(error);
  }
  refresh(requestId);
  redirect(`/signatures/${requestId}`);
}

export async function markSignatureSentAction(requestId: string, _state: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    markSignatureSent(session, requestId);
  } catch (error) {
    return fail(error);
  }
  refresh(requestId);
  return { ok: "Sent." };
}

export async function voidSignatureRequestAction(requestId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  try {
    voidSignatureRequest(session, requestId, String(formData.get("reason") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh(requestId);
  return { ok: "Voided." };
}

export async function saveVendorTradeAction(contactId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let requestId = "";
  try {
    const file = await readFile(formData);
    if (!file) return { error: "Choose a file." };
    requestId = createSignatureRequest(session, {
      title: String(formData.get("title") ?? "Trade agreement") || "Trade agreement",
      note: String(formData.get("note") ?? ""),
      kind: "trade",
      vendorContactId: contactId,
      dueOn: String(formData.get("dueOn") ?? ""),
      signers: [{ role: "vendor", contactId }],
      file,
    }).id;
    markSignatureSent(session, requestId);
  } catch (error) {
    return fail(error);
  }
  refresh(requestId);
  revalidatePath(`/contacts/${contactId}`);
  redirect(`/signatures/${requestId}`);
}

export async function replaceTradeAction(requestId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  let nextId = "";
  try {
    const file = await readFile(formData);
    if (!file) return { error: "Choose a file." };
    nextId = replaceTradeAgreement(session, requestId, file).id;
    markSignatureSent(session, nextId);
  } catch (error) {
    return fail(error);
  }
  refresh(requestId);
  refresh(nextId);
  redirect(`/signatures/${nextId}`);
}

export async function signDocumentAction(signerToken: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const headerList = await headers();
    const result = signByToken({
      token: signerToken,
      typedName: String(formData.get("typedName") ?? ""),
      drawn: String(formData.get("drawn") ?? ""),
      startedAt: String(formData.get("startedAt") ?? ""),
      companyUrl: String(formData.get("hp_field") ?? ""),
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
      userAgent: headerList.get("user-agent") || "",
    });
    if ("dropped" in result) return { ok: "Received." };
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/sign/${signerToken}`);
  revalidatePath(`/sign/${signerToken}/certificate`);
  revalidatePath("/signatures");
  redirect(`/sign/${signerToken}/certificate`);
}

export async function declineDocumentAction(signerToken: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const headerList = await headers();
    const result = declineByToken({
      token: signerToken,
      reason: String(formData.get("reason") ?? ""),
      startedAt: String(formData.get("startedAt") ?? ""),
      companyUrl: String(formData.get("hp_field") ?? ""),
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
      userAgent: headerList.get("user-agent") || "",
    });
    if ("dropped" in result) return { ok: "Received." };
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/sign/${signerToken}`);
  revalidatePath("/signatures");
  return { ok: "Declined." };
}
