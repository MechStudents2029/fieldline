import { PAY_GATE_MESSAGE, type WaiverMode } from "@/lib/waivers/format";

export const OVER_PO_MESSAGE = "This bill is over the purchase order.";

export type CertProblem = { type: string; state: "missing" | "expired" };

export type BillKind = "standard" | "release";

export type ReadinessInput = {
  status: string;
  waiverMode: WaiverMode;
  waiverSigned: boolean;
  certMode: "warn" | "block";
  certProblems: CertProblem[];
  overPo: boolean;
};

export type Readiness = {
  ready: boolean;
  reason: string | null;
  payError: string | null;
  payWarning: string | null;
};

/** One short reason. Expired general liability, then workers comp, then missing in that order. */
export function certReason(problems: CertProblem[]): string | null {
  if (problems.length === 0) return null;
  const rank = (problem: CertProblem) => {
    const state = problem.state === "expired" ? 0 : 1;
    const type = problem.type === "general_liability" ? 0 : problem.type === "workers_comp" ? 1 : 2;
    return state * 10 + type;
  };
  const top = [...problems].sort((a, b) => rank(a) - rank(b))[0];
  if (top.type === "general_liability" && top.state === "expired") return "COI expired";
  if (top.type === "workers_comp" && top.state === "expired") return "WC expired";
  if (top.type === "general_liability" && top.state === "missing") return "COI missing";
  if (top.type === "workers_comp" && top.state === "missing") return "WC missing";
  return "Certificate missing";
}

export function certProblems(
  required: string[],
  certificates: { type: string; expiresOn: string | null }[],
  today: string,
): CertProblem[] {
  const byType = new Map(certificates.map((row) => [row.type, row]));
  const problems: CertProblem[] = [];
  for (const type of required) {
    const row = byType.get(type);
    if (!row?.expiresOn) {
      problems.push({ type, state: "missing" });
      continue;
    }
    if (row.expiresOn < today) problems.push({ type, state: "expired" });
  }
  return problems;
}

type OverBill = {
  id: string;
  purchaseOrderId: string | null;
  status: string;
  kind: string;
  amountCents: number;
  createdAt: string;
};

/** Earlier bills that still fit are not flagged. The bill that crosses the PO, and anything after it, is. */
export function overPoIds(rows: OverBill[], poTotals: Map<string, number>): Set<string> {
  const over = new Set<string>();
  const groups = new Map<string, OverBill[]>();
  for (const bill of rows) {
    if (!bill.purchaseOrderId || bill.status === "void" || bill.kind === "release") continue;
    const list = groups.get(bill.purchaseOrderId) ?? [];
    list.push(bill);
    groups.set(bill.purchaseOrderId, list);
  }
  for (const [poId, list] of groups) {
    const total = poTotals.get(poId) ?? 0;
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    let used = 0;
    for (const bill of list) {
      if (used + bill.amountCents > total) over.add(bill.id);
      used += bill.amountCents;
    }
  }
  return over;
}

/**
 * Ready means approved, the waiver gate is clear, certificates are clear when that gate blocks,
 * and the bill is still inside the purchase order. Warn leaves the bill payable and shows the reason.
 */
export function billReadiness(input: ReadinessInput): Readiness {
  if (input.status !== "approved") return { ready: false, reason: null, payError: null, payWarning: null };
  const waiverOpen = !input.waiverSigned;
  const waiverBlocksReady = input.waiverMode !== "off" && waiverOpen;
  const certText = certReason(input.certProblems);
  const certBlocks = input.certMode === "block" && input.certProblems.length > 0;
  const ready = !waiverBlocksReady && !certBlocks && !input.overPo;
  let reason: string | null = null;
  if (!ready) {
    if (waiverBlocksReady) reason = "Waiver unsigned";
    else if (certBlocks && certText) reason = certText;
    else if (input.overPo) reason = "Over PO";
  }
  let payError: string | null = null;
  if (input.waiverMode === "block" && waiverOpen) payError = PAY_GATE_MESSAGE;
  else if (certBlocks) payError = certText ?? "Certificate missing";
  else if (input.overPo) payError = OVER_PO_MESSAGE;
  const warnings: string[] = [];
  if (input.waiverMode === "warn" && waiverOpen) warnings.push(PAY_GATE_MESSAGE);
  if (input.certMode === "warn" && input.certProblems.length > 0 && certText) warnings.push(certText);
  return { ready, reason, payError, payWarning: warnings[0] ?? null };
}
