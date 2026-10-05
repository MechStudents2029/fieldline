"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveLogin } from "@/lib/auth/login";
import { registerCompany } from "@/lib/auth/signup";
import { clearSession, getSession, setSession } from "@/lib/auth/session";
import { receiptAutoPostAllowed } from "@/lib/ai/receipt";
import { parseMoneyToCents } from "@/lib/money";
import { supabaseAuthConfigured } from "@/lib/supabase/env";
import { supabasePasswordAuth } from "@/lib/supabase/password";
import { ServiceError } from "@/lib/services/errors";
import { addStarterPriceBook, setSetupDismissed } from "@/lib/services/onboarding";
import {
  addCost,
  addPortalMessage,
  approveChangeOrder,
  approveDraft,
  attachLeadPhoto,
  attachPhotoNote,
  completeTask,
  createChangeOrder,
  createLeadFromText,
  createTask,
  declineProposal,
  dismissDraft,
  generateEstimate,
  issueNextInvoice,
  logNote,
  moveLead,
  payInvoice,
  captureReceipt,
  confirmReceiptCost,
  previewReceipt,
  readDemoReceipt,
  removeLine,
  reviseEstimate,
  sendChangeOrder,
  sendProposal,
  submitTesterFeedback,
  signProposal,
  updateLine,
  updateOrgSettings,
  addManualLine,
} from "@/lib/services/write";

export type ReceiptDraftState = {
  documentId: string;
  vendor: string;
  amount: string;
  purchasedOn: string;
  costCode: string;
  suggestionNote: string;
  confidence: number;
  note: string;
  lines: { description: string; amountCents: number | null }[];
};

export type ActionState = { error?: string; ok?: string; receipt?: ReceiptDraftState; postedDocumentId?: string } | null;

async function actor() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

function failure(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  throw error;
}

async function requestIp() {
  const headerList = await headers();
  return headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await resolveLogin(String(formData.get("email") || ""), String(formData.get("password") || ""), {
    env: process.env,
    auth: supabaseAuthConfigured() ? await supabasePasswordAuth() : undefined,
  });
  if (!result.ok) return { error: result.error };
  await setSession(result.actor);
  redirect("/");
}

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await registerCompany(
    {
      ownerName: String(formData.get("ownerName") || ""),
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
      companyName: String(formData.get("companyName") || ""),
      trade: String(formData.get("trade") || ""),
      state: String(formData.get("state") || ""),
      starter: formData.get("starter") === "on",
    },
    {
      env: process.env,
      ip: await requestIp(),
      auth: supabaseAuthConfigured() ? await supabasePasswordAuth() : undefined,
    },
  );
  if (result.status === "error") return { error: result.error };
  if (result.status === "confirm") return { ok: result.message };
  await setSession(result.actor);
  redirect("/");
}

export async function logoutAction() {
  if (supabaseAuthConfigured()) {
    const auth = await supabasePasswordAuth();
    await auth.signOut();
  }
  await clearSession();
  redirect("/login");
}

export async function createLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const created = createLeadFromText(user, String(formData.get("scope") || ""), String(formData.get("source") || "manual"));
    revalidatePath("/pipeline");
    redirect(`/leads/${created.leadId}`);
  } catch (error) {
    return failure(error);
  }
}

export async function moveLeadAction(leadId: string, stageId: string) {
  const user = await actor();
  moveLead(user, leadId, stageId);
  revalidatePath("/pipeline");
}

export async function moveLeadFormAction(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    moveLead(user, leadId, String(formData.get("stageId") || ""));
    revalidatePath("/pipeline");
    revalidatePath(`/leads/${leadId}`);
    return { ok: "Stage updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function noteAction(entityType: string, entityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    logNote(user, entityType, entityId, String(formData.get("summary") || ""));
    revalidatePath(`/leads/${entityId}`);
    revalidatePath(`/projects/${entityId}`);
    return { ok: "Noted." };
  } catch (error) {
    return failure(error);
  }
}

export async function taskAction(relatedType: string, relatedId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    createTask(user, {
      title: String(formData.get("title") || ""),
      relatedType,
      relatedId,
      dueAt: String(formData.get("due") || "") || undefined,
    });
    revalidatePath("/");
    return { ok: "Task added." };
  } catch (error) {
    return failure(error);
  }
}

export async function completeTaskAction(taskId: string) {
  const user = await actor();
  completeTask(user, taskId);
  revalidatePath("/");
}

export async function generateEstimateAction(leadId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const result = await generateEstimate(user, leadId);
    revalidatePath(`/leads/${leadId}`);
    redirect(`/estimates/${result.estimateId}`);
  } catch (error) {
    return failure(error);
  }
}

export async function updateLineAction(lineId: string, estimateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const qty = Number(formData.get("qty"));
    const unitCost = parseMoneyToCents(String(formData.get("unitCost") || ""));
    const markup = Number(formData.get("markup"));
    if (!Number.isFinite(qty) || unitCost == null || !Number.isFinite(markup)) {
      return { error: "Check quantity, unit cost, and markup." };
    }
    updateLine(user, lineId, { qty, unitCostCents: unitCost, markupBps: Math.round(markup * 100), name: String(formData.get("name") || "") });
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: "Line saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function addLineAction(estimateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const unitCost = parseMoneyToCents(String(formData.get("unitCost") || ""));
    if (unitCost == null) return { error: "Enter a unit cost." };
    addManualLine(user, estimateId, {
      name: String(formData.get("name") || ""),
      qty: Number(formData.get("qty") || 0),
      unit: String(formData.get("unit") || "ea"),
      unitCostCents: unitCost,
      markupBps: Math.round(Number(formData.get("markup") || 35) * 100),
      costCode: String(formData.get("costCode") || "") || undefined,
    });
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: "Line added." };
  } catch (error) {
    return failure(error);
  }
}

export async function removeLineAction(lineId: string, estimateId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    removeLine(user, lineId);
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: "Removed." };
  } catch (error) {
    return failure(error);
  }
}

export async function reviseAction(estimateId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const next = reviseEstimate(user, estimateId);
    redirect(`/estimates/${next.estimateId}`);
  } catch (error) {
    return failure(error);
  }
}

export async function sendProposalAction(estimateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const sent = await sendProposal(user, estimateId, formData.get("override") === "on");
    revalidatePath(`/estimates/${estimateId}`);
    redirect(`/p/${sent.publicToken}`);
  } catch (error) {
    return failure(error);
  }
}

export async function signAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const result = signProposal({
      token,
      signerName: String(formData.get("signerName") || ""),
      signerEmail: String(formData.get("email") || "") || undefined,
      typedName: String(formData.get("typedName") || ""),
      drawnDataUrl: String(formData.get("drawn") || "") || undefined,
      consent: formData.get("consent") === "on",
      ip: await requestIp(),
      userAgent: (await headers()).get("user-agent") || undefined,
    });
    redirect(`/portal/${result.portalToken}`);
  } catch (error) {
    return failure(error);
  }
}

export async function declineAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    declineProposal(token, String(formData.get("reason") || ""));
    revalidatePath(`/p/${token}`);
    return { ok: "Proposal declined." };
  } catch (error) {
    return failure(error);
  }
}

export async function payAction(token: string, idempotencyKey: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      return { error: "This invoice is collected by Stripe. Refresh the pay page and finish there." };
    }
    const method = String(formData.get("method") || "ach") === "card" ? "card" : "ach";
    const routing = String(formData.get("routing") || "");
    const account = String(formData.get("account") || "");
    const card = String(formData.get("card") || "");
    const result = payInvoice({
      token,
      method,
      routing,
      account,
      card,
      exp: String(formData.get("exp") || ""),
      cvc: String(formData.get("cvc") || ""),
      idempotencyKey: `${idempotencyKey}:${method}:${routing}:${account}:${card}`,
      ip: await requestIp(),
    });
    revalidatePath(`/pay/${token}`);
    if (!result.ok) return { error: result.reason || "Payment failed." };
    return { ok: result.duplicate ? "This payment was already recorded." : "Payment recorded. A receipt is on this page." };
  } catch (error) {
    return failure(error);
  }
}

export async function createCoAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const unitCost = parseMoneyToCents(String(formData.get("unitCost") || ""));
    if (unitCost == null) return { error: "Enter a unit cost." };
    const created = createChangeOrder(user, projectId, {
      title: String(formData.get("title") || ""),
      description: String(formData.get("description") || ""),
      name: String(formData.get("name") || ""),
      qty: Number(formData.get("qty") || 1),
      unit: String(formData.get("unit") || "ea"),
      unitCostCents: unitCost,
      markupBps: Math.round(Number(formData.get("markup") || 35) * 100),
      costCode: String(formData.get("costCode") || "") || undefined,
    });
    await sendChangeOrder(user, created.changeOrderId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: "Change order sent to the client portal." };
  } catch (error) {
    return failure(error);
  }
}

export async function draftCoAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const unitCost = parseMoneyToCents(String(formData.get("unitCost") || ""));
    if (unitCost == null) return { error: "Enter a unit cost." };
    createChangeOrder(user, projectId, {
      title: String(formData.get("title") || ""),
      description: String(formData.get("description") || ""),
      name: String(formData.get("name") || ""),
      qty: Number(formData.get("qty") || 1),
      unit: String(formData.get("unit") || "ea"),
      unitCostCents: unitCost,
      markupBps: Math.round(Number(formData.get("markup") || 35) * 100),
      costCode: String(formData.get("costCode") || "") || undefined,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/");
    return { ok: "Draft change order saved. It has not been sent to the client." };
  } catch (error) {
    return failure(error);
  }
}

export async function approveCoAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    approveChangeOrder({
      token,
      typedName: String(formData.get("typedName") || ""),
      consent: formData.get("consent") === "on",
      ip: await requestIp(),
      userAgent: (await headers()).get("user-agent") || undefined,
    });
    return { ok: "Change order approved. The contract and the next invoice are updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function addCostAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const amount = parseMoneyToCents(String(formData.get("amount") || ""));
    if (amount == null) return { error: "Enter an amount." };
    const posted = addCost(user, projectId, {
      amountCents: amount,
      vendorName: String(formData.get("vendor") || ""),
      costCode: String(formData.get("costCode") || "") || undefined,
      memo: String(formData.get("memo") || "") || undefined,
      source: String(formData.get("source") || "expense"),
      aiExtracted: formData.get("ai") === "1",
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: posted.alert ? "Cost posted. Margin watch fired." : "Cost posted." };
  } catch (error) {
    return failure(error);
  }
}

export async function receiptAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const sample = String(formData.get("sample") || "");
    const file = formData.get("file");
    let text = "";
    let filename = "receipt.txt";
    if (sample) {
      text = readDemoReceipt(sample);
      filename = sample;
    } else if (file instanceof File && file.size > 0) {
      if (file.size > 1_000_000) return { error: "Receipt files must be 1 MB or smaller." };
      text = await file.text();
      filename = file.name;
    } else {
      return { error: "Choose a receipt file or a sample." };
    }
    const captured = captureReceipt(user, projectId, filename, text);
    if (receiptAutoPostAllowed(captured.extraction.confidence, formData.get("post") === "on")) {
      return { error: "Confirm the receipt before posting it." };
    }
    const extracted = captured.extraction;
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/");
    const amount = extracted.amountCents == null ? "" : (extracted.amountCents / 100).toFixed(2);
    return {
      ok: extracted.amountCents
        ? `Read ${extracted.vendor ?? "a vendor"} for $${amount}. Confirm the fields, then post.`
        : extracted.note,
      receipt: {
        documentId: captured.documentId,
        vendor: extracted.vendor ?? "",
        amount,
        purchasedOn: extracted.purchasedOn ?? "",
        costCode: captured.suggestion?.code ?? "",
        suggestionNote: captured.suggestion?.reason ?? "No cost code matched the price book or past costs. Type one if you have it.",
        confidence: extracted.confidence,
        note: extracted.note,
        lines: extracted.lines,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmReceiptAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const amount = parseMoneyToCents(String(formData.get("amount") || ""));
    const vendor = String(formData.get("vendor") || "").trim();
    if (amount == null || !vendor) return { error: "Enter the vendor and amount before posting." };
    const purchasedOn = String(formData.get("purchasedOn") || "").trim();
    const lines = String(formData.get("lines") || "").trim();
    const memo = [purchasedOn ? `Purchased ${purchasedOn}` : "", lines].filter(Boolean).join(" · ") || undefined;
    const posted = confirmReceiptCost(user, projectId, {
      documentId: String(formData.get("documentId") || ""),
      amountCents: amount,
      vendorName: vendor,
      costCode: String(formData.get("costCode") || "") || undefined,
      memo,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/");
    return {
      ok: `${vendor} $${(amount / 100).toFixed(2)} posted.${posted.alert ? " Margin watch fired." : ""}`,
      postedDocumentId: String(formData.get("documentId") || ""),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function previewOnlyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const extracted = previewReceipt(String(formData.get("text") || ""));
  if (!extracted.amountCents) return { error: extracted.note };
  return { ok: `${extracted.vendor ?? "Vendor"} · $${(extracted.amountCents / 100).toFixed(2)}` };
}

export async function issueInvoiceAction(projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const issued = issueNextInvoice(user, projectId);
    revalidatePath(`/projects/${projectId}`);
    redirect(`/pay/${issued.payToken}`);
  } catch (error) {
    return failure(error);
  }
}

export async function approveDraftAction(draftId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const result = await approveDraft(user, draftId, String(formData.get("body") || ""));
    revalidatePath("/follow-ups");
    revalidatePath("/");
    redirect(result.stub ? "/follow-ups?sent=stub" : "/follow-ups?sent=1");
  } catch (error) {
    return failure(error);
  }
}

export async function dismissDraftAction(draftId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    dismissDraft(user, draftId);
    revalidatePath("/follow-ups");
    return { ok: "Dismissed." };
  } catch (error) {
    return failure(error);
  }
}

export async function portalMessageAction(portalToken: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    addPortalMessage(portalToken, String(formData.get("body") || ""));
    revalidatePath(`/portal/${portalToken}`);
    return { ok: "Message sent to your contractor." };
  } catch (error) {
    return failure(error);
  }
}

export async function settingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const license = formData.get("license");
    updateOrgSettings(user, {
      marginAlertBps: Math.round(Number(formData.get("margin") || 20) * 100),
      defaultMarkupBps: Math.round(Number(formData.get("markup") || 35) * 100),
      cardEnabled: formData.get("cards") === "on",
      ...(license == null ? {} : { licenseNumber: String(license) }),
    });
    revalidatePath("/settings");
    return { ok: "Settings saved." };
  } catch (error) {
    return failure(error);
  }
}

async function photoUpload(formData: FormData) {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return { filename: file.name || "photo.jpg", bytes: Buffer.from(await file.arrayBuffer()) };
}

export async function dismissSetupAction() {
  const user = await actor();
  setSetupDismissed(user, true);
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/more");
}

export async function restoreSetupAction() {
  const user = await actor();
  setSetupDismissed(user, false);
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/more");
}

export async function seedStarterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    addStarterPriceBook(user, String(formData.get("trade") || ""));
    revalidatePath("/price-book");
    revalidatePath("/");
    return { ok: "Starter price book added. Edit the prices before you send a proposal." };
  } catch (error) {
    return failure(error);
  }
}

export async function feedbackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    submitTesterFeedback(user, {
      path: String(formData.get("path") || "/"),
      body: String(formData.get("body") || ""),
      context: String(formData.get("context") || ""),
      userAgent: (await headers()).get("user-agent") || undefined,
    });
    revalidatePath("/feedback");
    return { ok: "Saved. Nothing was emailed." };
  } catch (error) {
    return failure(error);
  }
}

export async function reportBoundaryError(input: { ref: string; path: string; message: string; digest?: string }) {
  const { boundaryLogLine } = await import("@/lib/errors/report");
  console.error(boundaryLogLine(input));
}

export async function photoAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    attachPhotoNote(user, projectId, String(formData.get("caption") || ""), await photoUpload(formData));
    revalidatePath(`/projects/${projectId}`);
    return { ok: "Photo saved on the job." };
  } catch (error) {
    return failure(error);
  }
}

export async function leadPhotoAction(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    attachLeadPhoto(user, leadId, String(formData.get("caption") || ""), await photoUpload(formData));
    revalidatePath(`/leads/${leadId}`);
    return { ok: "Photo saved. Draft the estimate when you want it priced from the book." };
  } catch (error) {
    return failure(error);
  }
}

export async function askAction(question: string) {
  const user = await actor();
  const { askCopilot } = await import("@/lib/services/read");
  return askCopilot(user.orgId, question);
}
