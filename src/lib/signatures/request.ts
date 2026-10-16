import { createHash } from "node:crypto";

export type RequestStatus = "draft" | "out" | "signed" | "declined" | "voided";
export type SignerRole = "client" | "vendor" | "team";
export type SignerStatus = "waiting" | "signed" | "declined";

export type SignerState = {
  id: string;
  sortOrder: number;
  status: SignerStatus;
};

export type TradeVersion = {
  status: string;
  version: number;
};

export function fileSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function statusLabel(status: string): string {
  if (status === "out") return "Out for signature";
  if (status === "draft") return "Draft";
  if (status === "signed") return "Signed";
  if (status === "declined") return "Declined";
  if (status === "voided") return "Voided";
  return status;
}

export function sendError(status: string, hasDocument: boolean, signerCount: number): string | null {
  if (status !== "draft") return "Only a draft can be sent.";
  if (!hasDocument) return "Add a document.";
  if (signerCount < 1) return "Pick a signer.";
  return null;
}

export function voidError(status: string, reason: string, allowed: boolean): string | null {
  if (!allowed) return "Only an owner or admin can void a signature.";
  if (status === "voided") return "This request is already voided.";
  if (!reason.trim()) return "Add a reason.";
  return null;
}

export function turnError(ordered: boolean, signers: SignerState[], signerId: string): string | null {
  const signer = signers.find((row) => row.id === signerId);
  if (!signer) return "That signer is not on this request.";
  if (signer.status !== "waiting") return "This signer already answered.";
  if (!ordered) return null;
  const next = signers
    .filter((row) => row.status === "waiting")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))[0];
  if (!next || next.id !== signerId) return "Wait for the earlier signer.";
  return null;
}

export function statusAfter(signers: SignerState[], action: "sign" | "decline"): "out" | "signed" | "declined" {
  if (action === "decline") return "declined";
  return signers.every((row) => row.status === "signed") ? "signed" : "out";
}

export function isOverdue(status: string, dueOn: string | null | undefined, today: string): boolean {
  return status === "out" && Boolean(dueOn) && String(dueOn) < today;
}

export function tradePill(versions: TradeVersion[]): "Approved" | "Pending" | null {
  const live = versions.filter((row) => row.status !== "voided");
  if (live.length === 0) return null;
  const latest = [...live].sort((a, b) => b.version - a.version)[0];
  return latest.status === "signed" ? "Approved" : "Pending";
}

export function certificateLines(input: {
  title: string;
  hash: string;
  signers: { name: string; role: string; at: string; ip: string; userAgent: string }[];
  audit: { action: string; at: string }[];
}): string[] {
  const lines = [input.title, input.hash];
  for (const signer of input.signers) {
    lines.push(`${signer.name} ${signer.role} ${signer.at} ${signer.ip} ${signer.userAgent}`);
  }
  for (const row of input.audit) lines.push(`${row.action} ${row.at}`);
  return lines;
}
