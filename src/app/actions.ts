"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveLogin } from "@/lib/auth/login";
import { registerCompany } from "@/lib/auth/signup";
import { clearSession, getSession, setSession } from "@/lib/auth/session";
import { receiptAutoPostAllowed } from "@/lib/ai/receipt";
import { parseMoneyToCents, qtyToMilli } from "@/lib/money";
import {
  linkLogPhoto,
  openDailyLog,
  publishDailyLog,
  saveDailyLog,
  setLogVisibility,
  voidDailyLog,
} from "@/lib/services/logs";
import {
  addManualTime,
  approveEntries,
  approveTime,
  clockIn,
  clockOut,
  editTime,
  endBreak,
  officeClockOut,
  reopenTime,
  saveAndApprove,
  setHourlyCost,
  startBreak,
  switchJob,
  undoTime,
  updateWorkCalendar,
  voidTime,
} from "@/lib/services/time";
import type { TimeUndo } from "@/lib/services/time";
import { moveScheduleItem, rotateCalendarFeed, saveScheduleItem, type ScheduleStatus } from "@/lib/services/schedule";
import { previewScheduleShift, shiftScheduleDates } from "@/lib/services/schedule-shift";
import { createJobFromTemplate, importTemplate, renameTemplate, saveJobAsTemplate, type TemplatePart } from "@/lib/services/templates";
import {
  addTodoCheck,
  attachTodoFile,
  completeTodos,
  createTodo,
  deleteTodoCheck,
  reorderTodoChecks,
  renameTodoCheck,
  setTodoCheck,
  todoDetail,
  updateTodoCheck,
  vendorTick,
} from "@/lib/services/todos";
import { setWipOverride } from "@/lib/services/wip";
import { commitImport, previewImport, undoImport } from "@/lib/services/import";
import {
  approveSelection,
  chooseSelection,
  draftSelectionChangeOrder,
  lockSelection,
  releaseSelection,
  resetSelection,
  saveSelection,
} from "@/lib/services/selections";
import { supabaseAuthConfigured } from "@/lib/supabase/env";
import { supabasePasswordAuth } from "@/lib/supabase/password";
import { ServiceError } from "@/lib/services/errors";
import { regenerateLeadFormKey, saveLeadForm, submitLeadForm } from "@/lib/services/lead-form";
import {
  addPunchItem,
  closeJob,
  declineWarranty,
  markPunchDone,
  markSubstantial,
  reopenJob,
  resolveWarranty,
  scheduleWarranty,
  setPunchShared,
  setWarrantyMonths,
  submitWarranty,
  verifyPunch,
} from "@/lib/services/punch";
import { MAX_PHOTOS } from "@/lib/lead-form/rules";
import {
  acceptVendorPo,
  declineVendorPo,
  markVendorPunch,
  rotateVendorPortal,
  saveOfficeCertificate,
  saveVendorCertificate,
  setVendorCompliance,
  submitVendorBill,
} from "@/lib/services/vendor-portal";
import { awardBid, createBid, declineVendorBid, saveBidLines, submitVendorBid } from "@/lib/services/bids";
import { answerClientRfi, answerRfi, answerVendorRfi, closeRfi, createRfi, draftChangeFromRfi, shiftRfiSchedule, voidRfi } from "@/lib/services/rfis";
import { deleteComment, editComment, markAllRead, postComment, setNotifyPreference } from "@/lib/services/comments";
import { addStarterPriceBook, setSetupDismissed } from "@/lib/services/onboarding";
import { acceptExistingAccount, acceptNewAccount, changeMemberRole, createInvite, INVITE_EMAIL, previewInvite, removeMember, revokeInvite } from "@/lib/services/team";
import { verifyPassword } from "@/lib/auth/password";
import { canSeeMoney } from "@/lib/permissions";
import {
  approveBill,
  confirmBillRead,
  createBill,
  markBillPaid,
  readBillFile,
  unapproveBill,
  updateDraft,
  voidBill,
} from "@/lib/services/bills";
import {
  closePurchaseOrder,
  createPurchaseOrder,
  issuePurchaseOrder,
  savePurchaseOrder,
  voidPurchaseOrder,
} from "@/lib/services/purchase-orders";
import { passwordError } from "@/lib/security";
import { getDb } from "@/lib/db/client";
import { dailyLogs, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  billDraw,
  createPayApp,
  releaseRetainage,
  rollChangeOrder,
  saveBillingDefaults,
  saveDrawSchedule,
  setBillingMode,
  voidBilling,
} from "@/lib/services/draws";
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
  syncEstimateGrid,
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

export type ActionState = {
  error?: string;
  ok?: string;
  receipt?: ReceiptDraftState;
  postedDocumentId?: string;
  inviteUrl?: string;
  inviteMessage?: string;
  bill?: BillDraftState;
  feedUrl?: string;
  vendorUrl?: string;
  confirm?: string;
} | null;

export type BillDraftState = {
  documentId: string;
  projectId: string;
  vendorContactId: string;
  vendorLabel: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  confidence: number;
  lowConfidence: boolean;
  note: string;
  lines: { description: string; amount: string; costCode: string }[];
};

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
      timeZone: String(formData.get("timeZone") || ""),
      weekStartsOn: String(formData.get("weekStartsOn") || ""),
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

export async function syncEstimateGridAction(payload: unknown): Promise<ActionState> {
  try {
    const user = await actor();
    syncEstimateGrid(user, payload);
    const estimateId = typeof payload === "object" && payload && "estimateId" in payload ? String(payload.estimateId) : "";
    if (estimateId) revalidatePath(`/estimates/${estimateId}`);
    return { ok: "Line saved." };
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
    const approved = approveChangeOrder({
      token,
      typedName: String(formData.get("typedName") || ""),
      consent: formData.get("consent") === "on",
      ip: await requestIp(),
      userAgent: (await headers()).get("user-agent") || undefined,
    });
    revalidatePath(`/portal/${approved.portalToken}`);
    revalidatePath(`/projects/${approved.projectId}`);
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
    const showMoney = canSeeMoney(user.role);
    return {
      ok: showMoney
        ? extracted.amountCents
          ? `Read ${extracted.vendor ?? "a vendor"} for $${amount}. Confirm the fields, then post.`
          : extracted.note
        : "Saved on the job. An office person posts the cost.",
      receipt: {
        documentId: captured.documentId,
        vendor: extracted.vendor ?? "",
        amount: showMoney ? amount : "",
        purchasedOn: extracted.purchasedOn ?? "",
        costCode: captured.suggestion?.code ?? "",
        suggestionNote: captured.suggestion?.reason ?? "No cost code matched the price book or past costs. Type one if you have it.",
        confidence: extracted.confidence,
        note: showMoney ? extracted.note : "Saved on the job. An office person posts the cost.",
        lines: showMoney ? extracted.lines : extracted.lines.map((line) => ({ description: line.description, amountCents: null })),
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

export async function saveDrawsAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const ids = formData.getAll("drawId").map(String);
    const titles = formData.getAll("title").map(String);
    const basis = formData.getAll("basis").map(String);
    const percents = formData.getAll("percent").map(String);
    const amounts = formData.getAll("amount").map(String);
    const schedules = formData.getAll("scheduleItemId").map(String);
    const dues = formData.getAll("dueOn").map(String);
    saveDrawSchedule(
      user,
      projectId,
      ids.map((drawId, index) => ({
        id: drawId || undefined,
        title: titles[index] || "Draw",
        basis: basis[index] === "percent" ? "percent" : "fixed",
        bps: Math.round(Number(percents[index] || 0) * 100),
        amountCents: parseMoneyToCents(amounts[index] || "0") ?? 0,
        scheduleItemId: schedules[index] || null,
        dueOn: dues[index] || null,
      })),
    );
    revalidatePath(`/projects/${projectId}/draws`);
    revalidatePath(`/projects/${projectId}`);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function billDrawAction(drawId: string, projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const issued = billDraw(user, drawId);
    revalidatePath(`/projects/${projectId}/draws`);
    revalidatePath("/");
    redirect(`/pay/${issued.payToken}`);
  } catch (error) {
    return failure(error);
  }
}

export async function createPayAppAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const keys = formData.getAll("lineKey").map(String);
    const amounts = formData.getAll("thisAmount").map(String);
    const percents = formData.getAll("percent").map(String);
    const issued = createPayApp(
      user,
      projectId,
      keys.map((key, index) => {
        const dollars = amounts[index]?.trim();
        const percent = percents[index]?.trim();
        return {
          key,
          thisCents: dollars ? parseMoneyToCents(dollars) : null,
          percentBps: !dollars && percent ? Math.round(Number(percent) * 100) : null,
        };
      }),
    );
    revalidatePath(`/projects/${projectId}/draws`);
    revalidatePath("/");
    redirect(`/applications/${issued.invoiceId}`);
  } catch (error) {
    return failure(error);
  }
}

export async function setBillingModeAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const mode = String(formData.get("mode") || "draws") === "progress" ? "progress" : "draws";
    const retainage = Math.round(Number(formData.get("retainage") || 0) * 100);
    setBillingMode(user, projectId, mode, retainage);
    revalidatePath(`/projects/${projectId}/draws`);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function voidBillingAction(invoiceId: string, projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    voidBilling(user, invoiceId);
    revalidatePath(`/projects/${projectId}/draws`);
    return { ok: "Void." };
  } catch (error) {
    return failure(error);
  }
}

export async function releaseRetainageAction(projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const issued = releaseRetainage(user, projectId);
    revalidatePath(`/projects/${projectId}/draws`);
    redirect(`/pay/${issued.payToken}`);
  } catch (error) {
    return failure(error);
  }
}

export async function rollChangeOrderAction(changeOrderId: string, projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    rollChangeOrder(user, changeOrderId);
    revalidatePath(`/projects/${projectId}/draws`);
    return { ok: "Rolled into the next draw." };
  } catch (error) {
    return failure(error);
  }
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
    addPortalMessage(portalToken, String(formData.get("body") || ""), await photoUpload(formData));
    revalidatePath(`/portal/${portalToken}`);
    return { ok: "Sent." };
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
    const labor = formData.get("labor");
    if (labor != null && String(labor).trim()) {
      const cents = parseMoneyToCents(String(labor));
      if (cents == null || cents <= 0) return { error: "Enter the default hourly cost in dollars." };
      setHourlyCost(user, null, cents);
    }
    const timeZone = formData.get("timeZone");
    const weekStartsOn = formData.get("weekStartsOn");
    if (timeZone != null && weekStartsOn != null) {
      const workdays = formData.getAll("workday").map((day) => Number(day)).filter((day) => Number.isInteger(day));
      updateWorkCalendar(user, {
        timeZone: String(timeZone),
        weekStartsOn: Number(weekStartsOn),
        ...(workdays.length ? { workdays } : {}),
      });
    }
    const warrantyMonths = formData.get("warrantyMonths");
    if (warrantyMonths != null && String(warrantyMonths).trim()) setWarrantyMonths(user, Number(warrantyMonths));
    const vendorMode = formData.get("vendorComplianceMode");
    if (vendorMode != null) setVendorCompliance(user, String(vendorMode), formData.getAll("requiredType").map(String));
    const drawTitles = formData.getAll("drawTitle").map(String);
    if (drawTitles.length > 0) {
      const drawPercents = formData.getAll("drawPercent").map(String);
      saveBillingDefaults(user, {
        draws: drawTitles
          .map((title, index) => ({ title: title.trim(), bps: Math.round(Number(drawPercents[index] || 0) * 100) }))
          .filter((draw) => draw.title && draw.bps > 0),
        termsDays: Math.round(Number(formData.get("paymentTermsDays") || 7)),
        retainageBps: Math.round(Number(formData.get("defaultRetainage") || 0) * 100),
      });
    }
    revalidatePath("/settings");
    revalidatePath("/time");
    revalidatePath("/");
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
    return { ok: "Saved." };
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

export async function inviteTeammateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const invite = createInvite(user, {
      email: String(formData.get("email") || ""),
      role: String(formData.get("role") || ""),
    });
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: "Invite ready.", inviteUrl: invite.url, inviteMessage: invite.message };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeInviteAction(inviteId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    revokeInvite(user, inviteId);
    revalidatePath("/settings");
    return { ok: "Invite revoked." };
  } catch (error) {
    return failure(error);
  }
}

export async function changeRoleAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    changeMemberRole(user, userId, String(formData.get("role") || ""));
    revalidatePath("/settings");
    return { ok: "Role updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function removeMemberAction(userId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    removeMember(user, userId);
    revalidatePath("/settings");
    return { ok: "Teammate removed." };
  } catch (error) {
    return failure(error);
  }
}

export async function acceptInviteAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ip = await requestIp();
  const mode = String(formData.get("mode") || "create");
  const preview = previewInvite(token, { ip });
  if (!preview.ok) return { error: preview.error };
  const session = await getSession();
  if (session && session.email.toLowerCase() !== preview.preview.email) return { error: INVITE_EMAIL };
  if (session) {
    const joined = acceptExistingAccount(token, { userId: session.userId });
    if (!joined.ok) return { error: joined.error };
    await setSession(joined.actor);
    redirect("/");
  }
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "");
  if (supabaseAuthConfigured()) {
    const auth = await supabasePasswordAuth();
    if (!auth.signUp) return { error: "Supabase Auth is not available." };
    if (mode === "create") {
      const passwordMessage = passwordError(password);
      if (passwordMessage) return { error: passwordMessage };
      if (name.trim().length < 2 || name.trim().length > 80) return { error: "Your name must be 2–80 characters." };
      const signed = await auth.signUp({ email: preview.preview.email, password, name });
      if (!signed.ok) return { error: signed.error };
      if (!signed.confirmed) {
        return { ok: "Confirm this email in the message Supabase sent, then sign in on this page. Fieldline does not send a second email. The invite stays open." };
      }
      const created = acceptNewAccount(token, { name, password, authUserId: signed.userId });
      if (!created.ok) return { error: created.error };
      await setSession(created.actor);
      redirect("/");
    }
    const signed = await auth.signInWithPassword({ email: preview.preview.email, password });
    if (!signed.ok) return { error: "That email and password do not match." };
    const local = getDb().select().from(users).where(eq(users.email, preview.preview.email)).get();
    if (local && local.authUserId && local.authUserId !== signed.userId) return { error: INVITE_EMAIL };
    if (!local) {
      const created = acceptNewAccount(token, { name: preview.preview.email, password, authUserId: signed.userId });
      if (!created.ok) return { error: created.error };
      await setSession(created.actor);
      redirect("/");
    }
    if (!local.authUserId) {
      getDb().update(users).set({ authUserId: signed.userId }).where(eq(users.id, local.id)).run();
    }
    const joined = acceptExistingAccount(token, { userId: local.id });
    if (!joined.ok) return { error: joined.error };
    await setSession(joined.actor);
    redirect("/");
  }
  if (mode === "create") {
    const created = acceptNewAccount(token, { name, password });
    if (!created.ok) return { error: created.error };
    await setSession(created.actor);
    redirect("/");
  }
  const existing = getDb().select().from(users).where(eq(users.email, preview.preview.email)).get();
  if (!existing || !verifyPassword(password, existing.passwordSalt, existing.passwordHash)) {
    return { error: "That email and password do not match." };
  }
  const joined = acceptExistingAccount(token, { userId: existing.id });
  if (!joined.ok) return { error: joined.error };
  await setSession(joined.actor);
  redirect("/");
}

export async function askAction(question: string) {
  const user = await actor();
  const { askCopilot } = await import("@/lib/services/read");
  return askCopilot(user.orgId, question, user.role);
}

function timeRefresh(projectId?: string) {
  revalidatePath("/time");
  revalidatePath("/");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

export async function clockInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    clockIn(user, {
      projectId: String(formData.get("projectId") || ""),
      costCode: String(formData.get("costCode") || ""),
      lat: String(formData.get("lat") || ""),
      lng: String(formData.get("lng") || ""),
    });
    timeRefresh(String(formData.get("projectId") || ""));
    return { ok: "Clocked in." };
  } catch (error) {
    return failure(error);
  }
}

export async function switchJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    switchJob(user, { projectId: String(formData.get("projectId") || ""), costCode: String(formData.get("costCode") || "") });
    timeRefresh();
    return { ok: "Switched jobs. The earlier punch is waiting for the office." };
  } catch (error) {
    return failure(error);
  }
}

export async function breakAction(mode: "start" | "end", _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    if (mode === "start") startBreak(user);
    else endBreak(user);
    timeRefresh();
    return { ok: mode === "start" ? "Break started." : "Break ended." };
  } catch (error) {
    return failure(error);
  }
}

export async function clockOutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    clockOut(user, {
      note: String(formData.get("note") || ""),
      lat: String(formData.get("lat") || ""),
      lng: String(formData.get("lng") || ""),
    });
    timeRefresh();
    return { ok: "Clocked out. The office still has to approve it." };
  } catch (error) {
    return failure(error);
  }
}

export async function editTimeAction(entryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    editTime(user, entryId, {
      projectId: String(formData.get("projectId") || ""),
      costCode: String(formData.get("costCode") || ""),
      clockInAt: String(formData.get("clockInAt") || ""),
      clockOutAt: String(formData.get("clockOutAt") || ""),
      breakMinutes: Number(formData.get("breakMinutes") || 0),
      note: String(formData.get("note") || ""),
      reason: String(formData.get("reason") || ""),
    });
    timeRefresh(String(formData.get("projectId") || ""));
    return { ok: "Time updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function approveTimeAction(entryId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    approveTime(user, entryId);
    timeRefresh();
    return { ok: "Approved. Labor is on the job budget." };
  } catch (error) {
    return failure(error);
  }
}

export async function approveEntriesAction(entryIds: string[]): Promise<ActionState> {
  try {
    const user = await actor();
    const result = approveEntries(user, entryIds);
    timeRefresh();
    return { ok: result.posted.length ? "Approved. Labor is on the job budget." : "Already approved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveAndApproveAction(entryId: string, input: { projectId: string; costCode: string; clockInAt: string; clockOutAt: string; breakMinutes: number; note: string; reason: string }): Promise<ActionState> {
  try {
    const user = await actor();
    saveAndApprove(user, entryId, input);
    timeRefresh(input.projectId);
    return { ok: "Approved. Labor is on the job budget." };
  } catch (error) {
    return failure(error);
  }
}

export async function undoTimeAction(payload: TimeUndo): Promise<ActionState> {
  try {
    const user = await actor();
    undoTime(user, payload);
    timeRefresh();
    return { ok: "Undone." };
  } catch (error) {
    return failure(error);
  }
}

export async function officeClockOutAction(entryId: string, reason: string): Promise<ActionState> {
  try {
    const user = await actor();
    officeClockOut(user, entryId, reason);
    timeRefresh();
    return { ok: "Clocked out. The punch is waiting for approval." };
  } catch (error) {
    return failure(error);
  }
}

export async function reopenTimeAction(entryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    reopenTime(user, entryId, String(formData.get("reason") || ""));
    timeRefresh();
    return { ok: "Reopened. Approve it again after the change." };
  } catch (error) {
    return failure(error);
  }
}

export async function voidTimeAction(entryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    voidTime(user, entryId, String(formData.get("reason") || ""));
    timeRefresh();
    return { ok: "Voided. The punch stays on the record." };
  } catch (error) {
    return failure(error);
  }
}

export async function manualTimeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    addManualTime(user, {
      userId: String(formData.get("userId") || ""),
      projectId: String(formData.get("projectId") || ""),
      costCode: String(formData.get("costCode") || ""),
      clockInAt: String(formData.get("clockInAt") || ""),
      clockOutAt: String(formData.get("clockOutAt") || ""),
      breakMinutes: Number(formData.get("breakMinutes") || 0),
      note: String(formData.get("note") || ""),
      reason: String(formData.get("reason") || ""),
    });
    timeRefresh(String(formData.get("projectId") || ""));
    return { ok: "Manual entry added. Approve it to post the labor." };
  } catch (error) {
    return failure(error);
  }
}

function logInput(formData: FormData) {
  return {
    notes: String(formData.get("notes") ?? ""),
    plannedNext: String(formData.get("plannedNext") ?? ""),
    weatherSky: String(formData.get("weatherSky") ?? ""),
    weatherHighF: String(formData.get("weatherHighF") ?? ""),
    weatherLowF: String(formData.get("weatherLowF") ?? ""),
    weatherLostHours: String(formData.get("weatherLostHours") ?? ""),
    weatherImpact: String(formData.get("weatherImpact") ?? ""),
    delayCause: String(formData.get("delayCause") ?? ""),
    delayHours: String(formData.get("delayHours") ?? ""),
    deliveries: String(formData.get("deliveries") ?? ""),
    visitors: String(formData.get("visitors") ?? ""),
    safetyNote: String(formData.get("safetyNote") ?? ""),
  };
}

function refreshLog(projectId: string, logId?: string) {
  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/logs`);
  if (logId) revalidatePath(`/projects/${projectId}/logs/${logId}`);
}

export async function startLogAction(projectId: string, formData: FormData) {
  const user = await actor();
  const requested = String(formData.get("logDate") || "");
  const log = openDailyLog(user, projectId, requested);
  refreshLog(projectId, log.id);
  redirect(`/projects/${projectId}/logs/${log.id}`);
}

export async function saveLogAction(logId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const input = logInput(formData);
    if (String(formData.get("intent") || "") === "publish") publishDailyLog(user, logId, input);
    else saveDailyLog(user, logId, input);
    const log = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, logId)).get();
    if (log) refreshLog(log.projectId, log.id);
    return { ok: String(formData.get("intent") || "") === "publish" ? "Published." : "Draft saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function shareLogAction(logId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const visibility = String(formData.get("visibility") || "");
    setLogVisibility(user, logId, visibility);
    const log = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, logId)).get();
    if (log) refreshLog(log.projectId, log.id);
    return { ok: visibility === "client" ? "On the client portal." : "Hidden from the client portal." };
  } catch (error) {
    return failure(error);
  }
}

export async function voidLogAction(logId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    voidDailyLog(user, logId, String(formData.get("reason") || ""));
    const log = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, logId)).get();
    if (log) refreshLog(log.projectId, log.id);
    return { ok: "Voided. The log stays on the record." };
  } catch (error) {
    return failure(error);
  }
}

export async function logPhotoAction(logId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const log = getDb().select().from(dailyLogs).where(eq(dailyLogs.id, logId)).get();
    if (!log || log.orgId !== user.orgId) return { error: "Daily log not found." };
    const saved = attachPhotoNote(user, log.projectId, String(formData.get("caption") || ""), await photoUpload(formData));
    linkLogPhoto(user, logId, saved.documentId);
    refreshLog(log.projectId, log.id);
    return { ok: "Photo added to the log." };
  } catch (error) {
    return failure(error);
  }
}

function billInput(formData: FormData) {
  const codes = formData.getAll("costCode").map((value) => String(value));
  const amounts = formData.getAll("amount").map((value) => String(value));
  const descriptions = formData.getAll("description").map((value) => String(value));
  const lines = codes
    .map((costCode, index) => {
      const raw = amounts[index] ?? "";
      const description = descriptions[index] ?? "";
      if (!costCode.trim() && !raw.trim() && !description.trim()) return null;
      return { costCode, amountCents: parseMoneyToCents(raw) ?? 0, description };
    })
    .filter((line): line is { costCode: string; amountCents: number; description: string } => line != null);
  return {
    projectId: String(formData.get("projectId") || ""),
    vendorContactId: String(formData.get("vendorContactId") || ""),
    billNumber: String(formData.get("billNumber") || ""),
    billDate: String(formData.get("billDate") || ""),
    dueDate: String(formData.get("dueDate") || ""),
    memo: String(formData.get("memo") || ""),
    documentId: String(formData.get("documentId") || "") || null,
    purchaseOrderId: String(formData.get("purchaseOrderId") || "") || null,
    lowConfidence: formData.get("lowConfidence") === "1",
    lines,
  };
}

function poInput(formData: FormData) {
  const codes = formData.getAll("costCode").map((value) => String(value));
  const amounts = formData.getAll("amount").map((value) => String(value));
  const descriptions = formData.getAll("description").map((value) => String(value));
  const lines = codes
    .map((costCode, index) => {
      const raw = amounts[index] ?? "";
      const description = descriptions[index] ?? "";
      if (!costCode.trim() && !raw.trim() && !description.trim()) return null;
      return { costCode, amountCents: parseMoneyToCents(raw) ?? 0, description };
    })
    .filter((line): line is { costCode: string; amountCents: number; description: string } => line != null);
  return {
    projectId: String(formData.get("projectId") || ""),
    vendorContactId: String(formData.get("vendorContactId") || ""),
    scope: String(formData.get("scope") || ""),
    changeOrderId: String(formData.get("changeOrderId") || "") || null,
    lines,
  };
}

function refreshBill(projectId: string, billId: string) {
  revalidatePath("/bills");
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

function refreshPurchaseOrder(projectId: string, poId: string) {
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath(`/purchase-orders/${poId}/print`);
  revalidatePath("/");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

export async function readBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const projectId = String(formData.get("projectId") || "");
    if (!projectId) return { error: "Choose the job this bill belongs to." };
    const sample = String(formData.get("sample") || "");
    const file = formData.get("file");
    let text = "";
    let filename = "bill.txt";
    if (sample) {
      text = readDemoReceipt(sample);
      filename = sample;
    } else if (file instanceof File && file.size > 0) {
      if (file.size > 1_000_000) return { error: "Bill files must be 1 MB or smaller." };
      text = await file.text();
      filename = file.name || "bill.txt";
    } else {
      return { error: "Choose a bill file or a sample." };
    }
    const read = readBillFile(user, projectId, filename, text);
    return {
      ok: read.lowConfidence
        ? "Low confidence. This stays a draft until you confirm the vendor, date, and lines."
        : `Read ${read.vendorLabel || "a vendor"}. Review the lines, then save the draft.`,
      bill: {
        documentId: read.documentId,
        projectId,
        vendorContactId: read.vendorContactId,
        vendorLabel: read.vendorLabel,
        billNumber: read.billNumber,
        billDate: read.billDate,
        dueDate: read.dueDate,
        confidence: read.confidence,
        lowConfidence: read.lowConfidence,
        note: read.note,
        lines: read.lines.map((line) => ({
          description: line.description,
          amount: (line.amountCents / 100).toFixed(2),
          costCode: line.costCode,
        })),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const input = billInput(formData);
    const existing = String(formData.get("billId") || "");
    const saved = existing ? updateDraft(user, existing, input) : createBill(user, input);
    refreshBill(input.projectId, saved.id);
    redirect(`/bills/${saved.id}`);
  } catch (error) {
    return failure(error);
  }
}

export async function approveBillAction(billId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const result = approveBill(user, billId);
    refreshBill(String(formData.get("projectId") || ""), billId);
    const base = result.posted ? "Approved. The job cost includes this bill." : "This bill was already on the job.";
    return { ok: result.warning ? `${base} ${result.warning}` : base };
  } catch (error) {
    return failure(error);
  }
}

export async function unapproveBillAction(billId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    unapproveBill(user, billId, String(formData.get("reason") || ""));
    refreshBill(String(formData.get("projectId") || ""), billId);
    return { ok: "Moved back to draft. The job cost no longer includes this bill." };
  } catch (error) {
    return failure(error);
  }
}

export async function payBillAction(billId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    markBillPaid(user, billId, {
      paidOn: String(formData.get("paidOn") || ""),
      method: String(formData.get("method") || ""),
      reference: String(formData.get("reference") || ""),
    });
    refreshBill(String(formData.get("projectId") || ""), billId);
    return { ok: "Marked paid." };
  } catch (error) {
    return failure(error);
  }
}

export async function voidBillAction(billId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    voidBill(user, billId, String(formData.get("reason") || ""));
    refreshBill(String(formData.get("projectId") || ""), billId);
    return { ok: "Bill voided." };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmBillAction(billId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    confirmBillRead(user, billId);
    refreshBill(String(formData.get("projectId") || ""), billId);
    return { ok: "Read confirmed. You can approve it when the lines look right." };
  } catch (error) {
    return failure(error);
  }
}

export async function savePurchaseOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const input = poInput(formData);
    const existing = String(formData.get("purchaseOrderId") || "");
    const saved = existing ? savePurchaseOrder(user, existing, input) : createPurchaseOrder(user, input);
    refreshPurchaseOrder(input.projectId, saved.id);
    redirect(`/purchase-orders/${saved.id}`);
  } catch (error) {
    return failure(error);
  }
}

export async function issuePurchaseOrderAction(poId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const result = issuePurchaseOrder(user, poId);
    refreshPurchaseOrder(String(formData.get("projectId") || ""), poId);
    return { ok: result.warning ? `Issued ${result.number}. ${result.warning}` : `Issued ${result.number}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function closePurchaseOrderAction(poId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    closePurchaseOrder(user, poId);
    refreshPurchaseOrder(String(formData.get("projectId") || ""), poId);
    return { ok: "Closed. Any balance that was not billed is no longer committed." };
  } catch (error) {
    return failure(error);
  }
}

export async function voidPurchaseOrderAction(poId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    voidPurchaseOrder(user, poId, String(formData.get("reason") || ""));
    refreshPurchaseOrder(String(formData.get("projectId") || ""), poId);
    return { ok: "Purchase order voided." };
  } catch (error) {
    return failure(error);
  }
}

export async function laborRateAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const cents = parseMoneyToCents(String(formData.get("rate") || ""));
    if (cents == null || cents <= 0) return { error: "Enter an hourly cost in dollars." };
    setHourlyCost(user, userId || null, cents);
    revalidatePath("/time");
    revalidatePath("/settings");
    return { ok: "Hourly cost saved." };
  } catch (error) {
    return failure(error);
  }
}

function scheduleInput(formData: FormData) {
  const status = String(formData.get("status") || "planned");
  return {
    projectId: String(formData.get("projectId") || ""),
    title: String(formData.get("title") || ""),
    startDate: String(formData.get("startDate") || ""),
    endDate: String(formData.get("endDate") || ""),
    startTime: String(formData.get("startTime") || "") || null,
    status: (status === "confirmed" || status === "done" ? status : "planned") as ScheduleStatus,
    note: String(formData.get("note") || "") || null,
    assigneeIds: formData.getAll("assignee").map(String).filter(Boolean),
  };
}

function refreshSchedule(projectId: string) {
  revalidatePath("/schedule");
  revalidatePath("/");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

function scheduleLinks(formData: FormData) {
  if (formData.get("linksForm") !== "1") return undefined;
  return formData
    .getAll("pred")
    .map(String)
    .filter(Boolean)
    .map((predecessorId) => ({ predecessorId, lag: Number(formData.get(`lag-${predecessorId}`) || 0) }));
}

export async function saveScheduleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const input = scheduleInput(formData);
    const existing = String(formData.get("itemId") || "");
    if (existing && formData.get("confirmShift") !== "1") {
      const preview = previewScheduleShift(user, existing, input.startDate, input.endDate);
      if (preview.count > 1) return { confirm: preview.label };
    }
    saveScheduleItem(user, { ...input, links: scheduleLinks(formData) }, existing || undefined);
    refreshSchedule(input.projectId);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function previewScheduleShiftAction(input: { id: string; startDate: string; endDate: string }): Promise<{ count: number; label: string; error?: string }> {
  try {
    const user = await actor();
    const preview = previewScheduleShift(user, input.id, input.startDate, input.endDate);
    return { count: preview.count, label: preview.label };
  } catch (error) {
    if (error instanceof ServiceError) return { count: 0, label: "", error: error.message };
    throw error;
  }
}

export async function shiftScheduleDatesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const itemId = String(formData.get("itemId") || "");
    const startDate = String(formData.get("startDate") || "");
    const endDate = String(formData.get("endDate") || "");
    if (formData.get("confirmShift") !== "1") {
      const preview = previewScheduleShift(user, itemId, startDate, endDate);
      if (preview.count > 1) return { confirm: preview.label };
    }
    const result = shiftScheduleDates(user, itemId, startDate, endDate);
    refreshSchedule("");
    return { ok: result.count > 1 ? result.label : "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function moveScheduleAction(input: { id: string; startDate: string; endDate: string; assigneeId: string | null }): Promise<ActionState> {
  try {
    const user = await actor();
    moveScheduleItem(user, input.id, input);
    refreshSchedule("");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function previewImportAction(input: { kind: string; csv: string; mapping: string[] }) {
  try {
    const user = await actor();
    return previewImport(user, input);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

export async function commitImportAction(input: { kind: string; csv: string; mapping: string[]; choices: { index: number; choice?: string; mapToCode?: string }[] }) {
  try {
    const user = await actor();
    const result = commitImport(user, input);
    revalidatePath("/import");
    revalidatePath("/contacts");
    revalidatePath("/price-book");
    revalidatePath("/");
    return result;
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

export async function undoImportAction(batchId: string) {
  try {
    const user = await actor();
    const result = undoImport(user, batchId);
    revalidatePath("/import");
    revalidatePath("/contacts");
    revalidatePath("/price-book");
    revalidatePath("/");
    return result;
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

function selectionChoicesFromForm(formData: FormData) {
  const count = Number(formData.get("choiceCount") || 0);
  if (!Number.isInteger(count) || count < 2) return { error: "A selection needs two choices." } as const;
  const choices = [];
  for (let index = 0; index < count; index += 1) {
    const name = String(formData.get(`choice_${index}_name`) || "").trim();
    const price = parseMoneyToCents(String(formData.get(`choice_${index}_price`) || ""));
    const cost = parseMoneyToCents(String(formData.get(`choice_${index}_cost`) || ""));
    if (!name || price == null || cost == null) return { error: "Each choice needs a name, a price, and a cost." } as const;
    choices.push({
      name,
      vendor: String(formData.get(`choice_${index}_vendor`) || ""),
      sku: String(formData.get(`choice_${index}_sku`) || ""),
      link: String(formData.get(`choice_${index}_link`) || ""),
      note: String(formData.get(`choice_${index}_note`) || ""),
      photoDocumentId: null,
      unitPriceCents: price,
      unitCostCents: cost,
    });
  }
  return { choices };
}

function selectionInputFromForm(formData: FormData) {
  const parsed = selectionChoicesFromForm(formData);
  if ("error" in parsed) return parsed;
  const due = String(formData.get("due") || "");
  const qty = Number(formData.get("qty") || 1);
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantity must be greater than zero." } as const;
  const allowance = String(formData.get("allowanceId") || "");
  return {
    input: {
      title: String(formData.get("title") || ""),
      area: String(formData.get("area") || ""),
      dueDate: due || null,
      qtyMilli: qtyToMilli(qty),
      allowanceBudgetLineId: allowance || null,
      choices: parsed.choices,
    },
  };
}

export async function saveSelectionAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = selectionInputFromForm(formData);
  if ("error" in parsed && parsed.error) return { error: parsed.error };
  if (!("input" in parsed)) return { error: "A selection needs two choices." };
  try {
    const user = await actor();
    const existing = String(formData.get("selectionId") || "");
    saveSelection(user, projectId, existing || null, parsed.input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}/selections`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Saved" };
}

export async function releaseSelectionAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    releaseSelection(user, String(formData.get("selectionId") || ""));
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}/selections`);
  revalidatePath("/");
  return { ok: "Released" };
}

export async function approveSelectionAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    approveSelection(user, String(formData.get("selectionId") || ""), String(formData.get("choiceId") || ""), String(formData.get("note") || ""), await requestIp());
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}/selections`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Chosen" };
}

export async function resetSelectionAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    resetSelection(user, String(formData.get("selectionId") || ""), String(formData.get("reason") || ""));
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}/selections`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Reset" };
}

export async function lockSelectionAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    lockSelection(user, String(formData.get("selectionId") || ""));
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}/selections`);
  return { ok: "Locked" };
}

export async function draftSelectionCoAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    draftSelectionChangeOrder(user, String(formData.get("selectionId") || ""));
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}/selections`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Draft saved" };
}

export async function chooseSelectionAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    chooseSelection({
      token,
      selectionId: String(formData.get("selectionId") || ""),
      choiceId: String(formData.get("choiceId") || ""),
      typedName: String(formData.get("typedName") || ""),
      consent: formData.get("consent") === "on",
      ip: await requestIp(),
      userAgent: (await headers()).get("user-agent") || undefined,
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/portal/${token}`);
  redirect(`/portal/${token}#selections`);
}

async function leadFormPhotos(formData: FormData) {
  const files = formData.getAll("photos").filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length > MAX_PHOTOS) throw new ServiceError("Three photos at most.");
  const photos = [];
  for (const file of files) {
    photos.push({ filename: file.name || "photo.jpg", bytes: Buffer.from(await file.arrayBuffer()) });
  }
  return photos;
}

export async function saveLeadFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const types = String(formData.get("projectTypes") || "")
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    saveLeadForm(user, {
      enabled: formData.get("enabled") === "on",
      intro: String(formData.get("intro") || ""),
      thanks: String(formData.get("thanks") || ""),
      fields: {
        address: formData.get("address") === "on",
        projectType: formData.get("projectType") === "on",
        budget: formData.get("budget") === "on",
        timeline: formData.get("timeline") === "on",
        description: formData.get("description") === "on",
        photos: formData.get("photos") === "on",
      },
      projectTypes: types,
    });
    revalidatePath("/settings/lead-form");
    return { ok: "Saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function regenerateLeadFormAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    regenerateLeadFormKey(user);
    revalidatePath("/settings/lead-form");
    return { ok: "New link" };
  } catch (error) {
    return failure(error);
  }
}

export async function submitPublicLeadAction(formToken: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const headerList = await headers();
    const result = submitLeadForm({
      token: formToken,
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
      referrer: headerList.get("referer"),
      source: String(formData.get("source") || ""),
      utmSource: String(formData.get("utm_source") || ""),
      utmMedium: String(formData.get("utm_medium") || ""),
      utmCampaign: String(formData.get("utm_campaign") || ""),
      companyUrl: String(formData.get("hp_field") || ""),
      startedAt: String(formData.get("startedAt") || ""),
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      phone: String(formData.get("phone") || ""),
      address: String(formData.get("address") || ""),
      projectType: String(formData.get("projectType") || ""),
      budget: String(formData.get("budget") || ""),
      timeline: String(formData.get("timeline") || ""),
      description: String(formData.get("description") || ""),
      photos: await leadFormPhotos(formData),
    });
    if ("leadId" in result) {
      revalidatePath("/");
      revalidatePath("/pipeline");
      revalidatePath(`/leads/${result.leadId}`);
    }
    return { ok: "sent" };
  } catch (error) {
    return failure(error);
  }
}

async function onePhoto(formData: FormData) {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return { filename: file.name || "photo.jpg", bytes: Buffer.from(await file.arrayBuffer()) };
}

async function manyPhotos(formData: FormData) {
  const files = formData.getAll("photo").filter((file): file is File => file instanceof File && file.size > 0);
  const photos = [];
  for (const file of files) photos.push({ filename: file.name || "photo.jpg", bytes: Buffer.from(await file.arrayBuffer()) });
  return photos;
}

function refreshJob(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  revalidatePath("/schedule");
}

export async function addPunchAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    addPunchItem(
      user,
      projectId,
      {
        title: String(formData.get("title") || ""),
        location: String(formData.get("location") || ""),
        dueDate: String(formData.get("due") || ""),
        costCode: String(formData.get("costCode") || ""),
        assigneeUserId: String(formData.get("assigneeUser") || "") || null,
        assigneeContactId: String(formData.get("assigneeContact") || "") || null,
        shared: formData.get("shared") === "on",
      },
      await onePhoto(formData),
    );
    refreshJob(projectId);
    return { ok: "Added." };
  } catch (error) {
    return failure(error);
  }
}

export async function addFieldPunchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const projectId = String(formData.get("projectId") || "");
    addPunchItem(user, projectId, {
      title: String(formData.get("title") || ""),
      location: String(formData.get("location") || ""),
      dueDate: null,
      costCode: null,
      assigneeUserId: null,
      assigneeContactId: null,
      shared: false,
    });
    refreshJob(projectId);
    return { ok: "Added." };
  } catch (error) {
    return failure(error);
  }
}

export async function markPunchDoneAction(itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    markPunchDone(user, itemId, await onePhoto(formData));
    revalidatePath("/");
    revalidatePath("/projects");
    return { ok: "Done." };
  } catch (error) {
    return failure(error);
  }
}

export async function verifyPunchAction(itemId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    verifyPunch(user, itemId);
    revalidatePath("/projects");
    return { ok: "Verified." };
  } catch (error) {
    return failure(error);
  }
}

export async function setPunchSharedAction(itemId: string, shared: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    setPunchShared(user, itemId, shared === "1");
    revalidatePath("/projects");
    return { ok: shared === "1" ? "Shared." : "Hidden." };
  } catch (error) {
    return failure(error);
  }
}

export async function markSubstantialAction(projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    markSubstantial(user, projectId);
    refreshJob(projectId);
    return { ok: "Substantial." };
  } catch (error) {
    return failure(error);
  }
}

export async function closeJobAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const raw = String(formData.get("months") || "").trim();
    const months = raw ? Number(raw) : null;
    closeJob(user, projectId, { months: raw ? months : null, reason: String(formData.get("reason") || "") });
    refreshJob(projectId);
    return { ok: "Closed." };
  } catch (error) {
    return failure(error);
  }
}

export async function reopenJobAction(projectId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    reopenJob(user, projectId);
    refreshJob(projectId);
    return { ok: "Reopened." };
  } catch (error) {
    return failure(error);
  }
}

export async function scheduleWarrantyAction(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const note = scheduleWarranty(user, requestId, {
      assigneeUserId: String(formData.get("assignee") || ""),
      visitDate: String(formData.get("visit") || ""),
    });
    revalidatePath("/");
    revalidatePath("/schedule");
    revalidatePath("/projects");
    return { ok: note ?? "Scheduled." };
  } catch (error) {
    return failure(error);
  }
}

export async function resolveWarrantyAction(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const raw = String(formData.get("amount") || "").trim();
    let amountCents: number | null = null;
    if (raw) {
      const cents = parseMoneyToCents(raw);
      if (cents == null) return { error: "That amount is not valid." };
      amountCents = cents;
    }
    resolveWarranty(user, requestId, {
      clientNote: String(formData.get("note") || ""),
      internalNote: String(formData.get("internal") || ""),
      costCode: String(formData.get("costCode") || "") || null,
      amountCents,
    });
    revalidatePath("/");
    revalidatePath("/projects");
    return { ok: "Resolved." };
  } catch (error) {
    return failure(error);
  }
}

export async function declineWarrantyAction(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    declineWarranty(user, requestId, {
      clientNote: String(formData.get("note") || ""),
      internalNote: String(formData.get("internal") || ""),
    });
    revalidatePath("/");
    revalidatePath("/projects");
    return { ok: "Declined." };
  } catch (error) {
    return failure(error);
  }
}

export async function submitWarrantyAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const photos = await manyPhotos(formData);
    if (photos.length > MAX_PHOTOS) return { error: "Three photos at most." };
    const result = submitWarranty({
      token,
      ip: await requestIp(),
      honeypot: String(formData.get("hp_field") || ""),
      startedAt: String(formData.get("startedAt") || ""),
      title: String(formData.get("title") || ""),
      description: String(formData.get("description") || ""),
      urgency: String(formData.get("urgency") || ""),
      photos,
    });
    if ("id" in result) revalidatePath(`/portal/${token}`);
    return { ok: "Sent." };
  } catch (error) {
    return failure(error);
  }
}

export async function rotateCalendarFeedAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const token = rotateCalendarFeed(user);
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host") || "localhost";
    const proto = headerList.get("x-forwarded-proto") || "http";
    revalidatePath("/settings");
    return { feedUrl: `${proto}://${host}/feed/${token}` };
  } catch (error) {
    return failure(error);
  }
}

function refreshVendor(token: string) {
  revalidatePath(`/v/${token}`);
  revalidatePath("/");
  revalidatePath("/bills");
  revalidatePath("/contacts");
}

async function namedUpload(formData: FormData, key: string) {
  const file = formData.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  return { filename: file.name || "photo.jpg", bytes: Buffer.from(await file.arrayBuffer()) };
}

export async function rotateVendorPortalAction(contactId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const token = rotateVendorPortal(user, contactId);
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host") || "localhost";
    const proto = headerList.get("x-forwarded-proto") || "http";
    revalidatePath(`/contacts/${contactId}`);
    return { vendorUrl: `${proto}://${host}/v/${token}` };
  } catch (error) {
    return failure(error);
  }
}

export async function saveOfficeCertificateAction(contactId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    saveOfficeCertificate(user, contactId, String(formData.get("type") || ""), String(formData.get("expiresOn") || ""), await namedUpload(formData, "file"));
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath("/");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function acceptVendorPoAction(token: string, purchaseOrderId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    acceptVendorPo({ token, purchaseOrderId, name: String(formData.get("name") || ""), ip: await requestIp() });
    refreshVendor(token);
    return { ok: "Accepted." };
  } catch (error) {
    return failure(error);
  }
}

export async function declineVendorPoAction(token: string, purchaseOrderId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    declineVendorPo({ token, purchaseOrderId, reason: String(formData.get("reason") || ""), ip: await requestIp() });
    refreshVendor(token);
    return { ok: "Declined." };
  } catch (error) {
    return failure(error);
  }
}

export async function submitVendorBillAction(token: string, purchaseOrderId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const codes = formData.getAll("lineCode").map(String);
    const amounts = formData.getAll("lineAmount").map(String);
    const lines: { costCode: string; amountCents: number }[] = [];
    for (let index = 0; index < codes.length; index += 1) {
      const raw = String(amounts[index] ?? "").trim();
      if (!raw) continue;
      const cents = parseMoneyToCents(raw);
      if (cents == null) return { error: "Enter an amount." };
      lines.push({ costCode: codes[index], amountCents: cents });
    }
    const result = submitVendorBill({
      token,
      ip: await requestIp(),
      purchaseOrderId,
      billNumber: String(formData.get("billNumber") || ""),
      billDate: String(formData.get("billDate") || ""),
      dueDate: String(formData.get("dueDate") || ""),
      lines,
      file: await namedUpload(formData, "file"),
    });
    refreshVendor(token);
    return { ok: result.warning ? `Draft. ${result.warning}` : "Draft." };
  } catch (error) {
    return failure(error);
  }
}

export async function markVendorPunchAction(token: string, itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    markVendorPunch({ token, ip: await requestIp(), itemId, photo: await namedUpload(formData, "photo") });
    refreshVendor(token);
    return { ok: "Done." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveVendorCertificateAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    saveVendorCertificate({
      token,
      ip: await requestIp(),
      type: String(formData.get("type") || ""),
      expiresOn: String(formData.get("expiresOn") || ""),
      file: await namedUpload(formData, "file"),
    });
    refreshVendor(token);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

function qtyMilliFrom(value: string) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) throw new ServiceError("Enter a quantity.");
  return qtyToMilli(qty);
}

export async function createBidAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const lines = formData.getAll("budgetLine").map((value) => {
      const budgetLineId = String(value);
      return {
        budgetLineId,
        costCode: "",
        description: "",
        qtyMilli: qtyMilliFrom(String(formData.get(`qty_${budgetLineId}`) || "1")),
        unit: String(formData.get(`unit_${budgetLineId}`) || "ea"),
      };
    });
    const extraCode = String(formData.get("extraCode") || "").trim();
    if (extraCode) {
      lines.push({
        budgetLineId: "",
        costCode: extraCode,
        description: String(formData.get("extraName") || ""),
        qtyMilli: qtyMilliFrom(String(formData.get("extraQty") || "1")),
        unit: String(formData.get("extraUnit") || "ea"),
      });
    }
    createBid(user, {
      projectId,
      title: String(formData.get("title") || ""),
      scope: String(formData.get("scope") || ""),
      dueOn: String(formData.get("dueOn") || ""),
      lines,
      vendorContactIds: formData.getAll("vendor").map(String),
      file: await namedUpload(formData, "file"),
    });
    revalidatePath(`/projects/${projectId}/bids`);
    revalidatePath("/");
    return { ok: "Requested." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveBidLinesAction(bidId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const lines = formData.getAll("lineId").map((value) => {
      const lineId = String(value);
      return {
        costCode: String(formData.get(`code_${lineId}`) || ""),
        description: String(formData.get(`name_${lineId}`) || ""),
        qtyMilli: qtyMilliFrom(String(formData.get(`qty_${lineId}`) || "1")),
        unit: String(formData.get(`unit_${lineId}`) || "ea"),
        budgetLineId: String(formData.get(`budget_${lineId}`) || "") || null,
      };
    });
    const result = saveBidLines(user, bidId, lines);
    revalidatePath(`/bids/${bidId}`);
    return { ok: result.warning ? `Saved. ${result.warning}` : "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function awardBidAction(bidId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const assignments = formData.getAll("lineId").map((value) => {
      const bidLineId = String(value);
      return { bidLineId, contactId: String(formData.get(`award_${bidLineId}`) || "") };
    });
    const result = awardBid(user, {
      bidId,
      assignments,
      createPurchaseOrders: formData.get("createPo") != null,
      updateBudget: formData.get("updateBudget") != null,
    });
    revalidatePath(`/bids/${bidId}`);
    revalidatePath("/purchase-orders");
    revalidatePath("/");
    return { ok: result.warning ? `Awarded. ${result.warning}` : "Awarded." };
  } catch (error) {
    return failure(error);
  }
}

export async function submitVendorBidAction(token: string, bidId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const noBid = new Set(formData.getAll("noBid").map(String));
    const lineIds = formData.getAll("lineId").map(String);
    const amounts = formData.getAll("unitPrice").map(String);
    const prices = lineIds.map((bidLineId, index) => {
      const skipped = noBid.has(bidLineId);
      return { bidLineId, noBid: skipped, unitPriceCents: skipped ? null : parseMoneyToCents(amounts[index] || "") };
    });
    submitVendorBid({
      token,
      ip: await requestIp(),
      bidId,
      name: String(formData.get("name") || ""),
      note: String(formData.get("note") || ""),
      prices,
      file: await namedUpload(formData, "file"),
    });
    refreshVendor(token);
    revalidatePath(`/bids/${bidId}`);
    return { ok: "Sent." };
  } catch (error) {
    return failure(error);
  }
}

function refreshRfi(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/rfis");
  revalidatePath("/");
  revalidatePath("/schedule");
}

export async function createRfiAction(projectId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    createRfi(
      user,
      projectId,
      {
        title: String(formData.get("title") || ""),
        question: String(formData.get("question") || ""),
        dueOn: String(formData.get("due") || ""),
        assignee: String(formData.get("assignee") || ""),
        related: String(formData.get("related") || "") || null,
        internalNote: String(formData.get("internalNote") || "") || null,
      },
      await manyPhotos(formData),
    );
    refreshRfi(projectId);
    return { ok: "Added." };
  } catch (error) {
    return failure(error);
  }
}

export async function answerRfiAction(rfiId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const days = String(formData.get("days") || "").trim();
    const cost = String(formData.get("cost") || "").trim();
    answerRfi(
      user,
      rfiId,
      {
        body: String(formData.get("body") || ""),
        internal: formData.get("internal") === "1",
        costImpact: formData.has("costImpact") ? formData.get("costImpact") === "1" : undefined,
        costImpactCents: cost ? parseMoneyToCents(cost) : undefined,
        scheduleImpactDays: days ? Number(days) : undefined,
      },
      await manyPhotos(formData),
    );
    revalidatePath("/rfis");
    revalidatePath("/projects");
    return { ok: "Sent." };
  } catch (error) {
    return failure(error);
  }
}

export async function closeRfiAction(rfiId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const days = String(formData.get("days") || "").trim();
    const cost = String(formData.get("cost") || "").trim();
    closeRfi(user, rfiId, {
      costImpact: formData.get("costImpact") === "1",
      costImpactCents: cost ? parseMoneyToCents(cost) : null,
      scheduleImpactDays: days ? Number(days) : null,
    });
    revalidatePath("/rfis");
    revalidatePath("/projects");
    revalidatePath("/");
    return { ok: "Closed." };
  } catch (error) {
    return failure(error);
  }
}

export async function voidRfiAction(rfiId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    voidRfi(user, rfiId);
    revalidatePath("/rfis");
    revalidatePath("/projects");
    return { ok: "Void." };
  } catch (error) {
    return failure(error);
  }
}

export async function draftRfiChangeAction(rfiId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    draftChangeFromRfi(user, rfiId);
    revalidatePath("/projects");
    revalidatePath("/rfis");
    return { ok: "Draft." };
  } catch (error) {
    return failure(error);
  }
}

export async function shiftRfiAction(rfiId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    shiftRfiSchedule(user, rfiId);
    revalidatePath("/schedule");
    revalidatePath("/projects");
    return { ok: "Shifted." };
  } catch (error) {
    return failure(error);
  }
}

export async function answerVendorRfiAction(token: string, rfiId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    answerVendorRfi({ token, rfiId, body: String(formData.get("body") || ""), files: await manyPhotos(formData), ip: await requestIp() });
    revalidatePath(`/v/${token}`);
    revalidatePath("/projects");
    return { ok: "Sent." };
  } catch (error) {
    return failure(error);
  }
}

export async function answerClientRfiAction(token: string, rfiId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    answerClientRfi({ token, rfiId, body: String(formData.get("body") || ""), files: await manyPhotos(formData), ip: await requestIp() });
    revalidatePath(`/portal/${token}`);
    revalidatePath("/projects");
    return { ok: "Sent." };
  } catch (error) {
    return failure(error);
  }
}

export async function postCommentAction(entityType: string, entityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    postComment(user, entityType, entityId, String(formData.get("body") || ""), await onePhoto(formData));
    revalidatePath("/inbox");
    revalidatePath("/");
    return { ok: "Posted." };
  } catch (error) {
    return failure(error);
  }
}

export async function editCommentAction(commentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    editComment(user, commentId, String(formData.get("body") || ""));
    revalidatePath("/inbox");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteCommentAction(commentId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    deleteComment(user, commentId);
    revalidatePath("/inbox");
    return { ok: "Deleted." };
  } catch (error) {
    return failure(error);
  }
}

export async function markAllReadAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    markAllRead(user);
    revalidatePath("/inbox");
    revalidatePath("/");
    return { ok: "Read." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveNotifyModeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    setNotifyPreference(user, String(formData.get("mode") || ""));
    revalidatePath("/inbox");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

function templateParts(formData: FormData): TemplatePart[] {
  return formData.getAll("part").map(String).filter((part): part is TemplatePart => ["schedule", "estimate", "draws", "selections", "punch", "todos"].includes(part));
}

function tradeMap(formData: FormData): Record<string, string | null> {
  const trades: Record<string, string | null> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("trade:")) continue;
    const trade = key.slice("trade:".length);
    const vendor = String(value || "");
    trades[trade] = vendor || null;
  }
  return trades;
}

export async function createJobFromTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const result = createJobFromTemplate(user, {
      templateId: String(formData.get("templateId") || ""),
      name: String(formData.get("name") || ""),
      contactId: String(formData.get("contactId") || ""),
      address: String(formData.get("address") || ""),
      startDate: String(formData.get("startDate") || ""),
      pmUserId: String(formData.get("pmUserId") || ""),
      parts: templateParts(formData),
      trades: tradeMap(formData),
    });
    revalidatePath("/projects");
    revalidatePath("/templates");
    redirect(`/projects/${result.projectId}?created=${result.created}`);
  } catch (error) {
    return failure(error);
  }
}

export async function saveJobAsTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const projectId = String(formData.get("projectId") || "");
    const templateId = saveJobAsTemplate(user, projectId, {
      name: String(formData.get("name") || ""),
      jobType: String(formData.get("jobType") || ""),
      parts: templateParts(formData),
    });
    revalidatePath("/templates");
    redirect(`/templates/${templateId}`);
  } catch (error) {
    return failure(error);
  }
}

export async function importTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const projectId = String(formData.get("projectId") || "");
    const result = importTemplate(user, {
      projectId,
      templateId: String(formData.get("templateId") || ""),
      parts: templateParts(formData),
      anchor: String(formData.get("anchor") || ""),
      trades: tradeMap(formData),
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/schedule");
    return { ok: `Added ${result.created} items` };
  } catch (error) {
    return failure(error);
  }
}

export async function renameTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const templateId = String(formData.get("templateId") || "");
    renameTemplate(user, templateId, String(formData.get("name") || ""), String(formData.get("jobType") || ""));
    revalidatePath("/templates");
    revalidatePath(`/templates/${templateId}`);
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function setWipOverrideAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = String(formData.get("projectId") || "");
  const asof = String(formData.get("asof") || "");
  try {
    const user = await actor();
    const amount = parseMoneyToCents(String(formData.get("amount") || ""));
    if (amount == null) return { error: "That amount is not valid." };
    setWipOverride(user, projectId, { amountCents: amount, note: String(formData.get("note") || "") });
    revalidatePath("/");
    revalidatePath("/reports/wip");
    revalidatePath(`/reports/wip/${projectId}`);
    redirect(`/reports/wip/${projectId}?asof=${encodeURIComponent(asof)}`);
  } catch (error) {
    return failure(error);
  }
}

function refreshTodos() {
  revalidatePath("/todos");
  revalidatePath("/");
  revalidatePath("/inbox");
}

function linesOf(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((title) => ({ title }));
}

export async function createTodoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
  const user = await actor();
  const remind = String(formData.get("remindDays") || "");
  const offset = String(formData.get("deadlineOffset") || "");
  const taskId = createTodo(user, {
    title: String(formData.get("title") || ""),
    projectId: String(formData.get("projectId") || ""),
    notes: String(formData.get("notes") || ""),
    priority: String(formData.get("priority") || "normal"),
    tags: String(formData.get("tags") || ""),
    dueAt: String(formData.get("dueAt") || ""),
    scheduleItemId: String(formData.get("scheduleItemId") || "") || null,
    deadlineEdge: String(formData.get("deadlineEdge") || "") || null,
    deadlineOffset: offset.trim() ? Number(offset) : null,
    remindDays: remind.trim() ? Number(remind) : null,
    userIds: formData.getAll("userId").map(String).filter(Boolean),
    contactIds: formData.getAll("contactId").map(String).filter(Boolean),
    checks: linesOf(String(formData.get("checks") || "")),
  });
  refreshTodos();
  redirect(`/todos?task=${taskId}`);
  } catch (error) {
    return failure(error);
  }
}

export async function addTodoCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    addTodoCheck(user, String(formData.get("taskId") || ""), String(formData.get("title") || ""));
    refreshTodos();
    return { ok: "Added." };
  } catch (error) {
    return failure(error);
  }
}

export async function renameTodoCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    renameTodoCheck(user, String(formData.get("checkId") || ""), String(formData.get("title") || ""));
    refreshTodos();
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteTodoCheckAction(checkId: string) {
  const user = await actor();
  deleteTodoCheck(user, checkId);
  refreshTodos();
}

export async function moveTodoCheckAction(taskId: string, checkId: string, direction: "up" | "down") {
  const user = await actor();
  const detail = todoDetail(user, taskId);
  if (!detail) return;
  const ids = detail.checks.map((row) => row.id);
  const index = ids.indexOf(checkId);
  const next = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= ids.length) return;
  const swapped = [...ids];
  const current = swapped[index];
  const neighbor = swapped[next];
  if (!current || !neighbor) return;
  swapped[index] = neighbor;
  swapped[next] = current;
  reorderTodoChecks(user, taskId, swapped);
  refreshTodos();
}

export async function reorderTodoChecksAction(taskId: string, orderedIds: string[]) {
  const user = await actor();
  reorderTodoChecks(user, taskId, orderedIds);
  refreshTodos();
}

export async function setTodoCheckAction(checkId: string, done: boolean) {
  const user = await actor();
  setTodoCheck(user, checkId, done);
  refreshTodos();
}

export async function updateTodoCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const who = String(formData.get("assignee") || "");
    updateTodoCheck(user, String(formData.get("checkId") || ""), {
      assigneeUserId: who.startsWith("user:") ? who.slice(5) : null,
      assigneeContactId: who.startsWith("vendor:") ? who.slice(7) : null,
      dueAt: String(formData.get("dueAt") || ""),
    });
    refreshTodos();
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function completeTodosAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const ids = formData.getAll("taskId").map(String).filter(Boolean);
    if (ids.length === 0) return { error: "Pick a to-do." };
    completeTodos(user, ids);
    refreshTodos();
    return { ok: "Done." };
  } catch (error) {
    return failure(error);
  }
}

export async function attachTodoFileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const upload = await namedUpload(formData, "photo");
    if (!upload) return { error: "Choose a photo." };
    attachTodoFile(user, String(formData.get("taskId") || ""), upload, String(formData.get("checkId") || "") || null);
    refreshTodos();
    return { ok: "Attached." };
  } catch (error) {
    return failure(error);
  }
}

export async function vendorTickAction(token: string, checkId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const done = String(formData.get("done") || "1") !== "0";
    vendorTick(token, checkId, done, await namedUpload(formData, "photo"));
    refreshVendor(token);
    return { ok: done ? "Done." : "Open." };
  } catch (error) {
    return failure(error);
  }
}

export async function declineVendorBidAction(token: string, bidId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    declineVendorBid({ token, ip: await requestIp(), bidId, reason: String(formData.get("reason") || "") });
    refreshVendor(token);
    revalidatePath(`/bids/${bidId}`);
    return { ok: "Declined." };
  } catch (error) {
    return failure(error);
  }
}
