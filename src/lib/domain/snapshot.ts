import { countsTowardTotal, type Billing } from "@/lib/estimate/pricing";
import { CONSENT_VERSION, PROPOSAL_DISCLAIMER } from "@/lib/product";
import { parseDefaultDraws } from "@/lib/draws/math";
import { formatQty, lineAmounts, scheduleAmounts, taxCents } from "@/lib/money";

export type SnapshotLineInput = {
  name: string;
  qtyMilli: number;
  unit: string;
  unitCostCents: number;
  markupBps: number;
  costCode: string | null;
  billing?: Billing;
  groupId?: string | null;
  groupName?: string | null;
  presentAs?: "one" | "parts" | null;
  groupQtyMilli?: number | null;
  groupUnit?: string | null;
};

export type InternalLine = {
  name: string;
  costCode: string | null;
  costCents: number;
  priceCents: number;
  qtyMilli: number;
  unit: string;
};

export type PublicSnapshot = {
  title: string;
  company: string;
  clientName: string;
  address: string;
  sections: {
    name: string;
    lines: {
      name: string;
      qty: string;
      unit: string;
      unitPriceCents: number;
      priceCents: number;
      kind?: "optional" | "allowance";
    }[];
  }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  schedule: { type: string; label: string; bps: number; amountCents: number }[];
  termsVersion: string;
  disclaimer: string;
};

export type StoredSnapshot = {
  public: PublicSnapshot;
  lines: InternalLine[];
};

export function assembleSnapshot(input: {
  title: string;
  company: string;
  clientName: string;
  address: string;
  sections: { name: string; lines: SnapshotLineInput[] }[];
  taxBps: number;
  scheduleParts: { type: string; label: string; bps: number }[];
  termsVersion?: string;
}): StoredSnapshot {
  const internal: InternalLine[] = [];
  const sections = input.sections.flatMap((section) => {
    const lines: PublicSnapshot["sections"][number]["lines"] = [];
    const seen = new Set<string>();
    for (const line of section.lines) {
      const billing = line.billing ?? "included";
      if (billing === "excluded") continue;
      const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
      if (countsTowardTotal(billing)) {
        internal.push({
          name: line.name,
          costCode: line.costCode,
          costCents: amounts.cost,
          priceCents: amounts.price,
          qtyMilli: line.qtyMilli,
          unit: line.unit,
        });
      }
      if (line.groupId && line.presentAs === "one" && line.groupName) {
        if (seen.has(line.groupId)) continue;
        seen.add(line.groupId);
        const members = section.lines.filter((row) => row.groupId === line.groupId && (row.billing ?? "included") !== "excluded");
        const priceCents = members.reduce((sum, row) => {
          if (!countsTowardTotal(row.billing ?? "included")) return sum;
          return sum + lineAmounts(row.qtyMilli, row.unitCostCents, row.markupBps).price;
        }, 0);
        const qtyMilli = line.groupQtyMilli ?? line.qtyMilli;
        const qty = qtyMilli / 1000;
        lines.push({
          name: line.groupName,
          qty: formatQty(qtyMilli),
          unit: line.groupUnit || line.unit,
          unitPriceCents: qty === 0 ? 0 : Math.round(priceCents / qty),
          priceCents,
        });
        continue;
      }
      const qty = line.qtyMilli / 1000;
      lines.push({
        name: line.name,
        qty: formatQty(line.qtyMilli),
        unit: line.unit,
        unitPriceCents: qty === 0 ? 0 : Math.round(amounts.price / qty),
        priceCents: amounts.price,
        ...(billing === "optional" || billing === "allowance" ? { kind: billing } : {}),
      });
    }
    return lines.length ? [{ name: section.name, lines }] : [];
  });

  const subtotalCents = internal.reduce((sum, line) => sum + line.priceCents, 0);
  const tax = taxCents(subtotalCents, input.taxBps);
  const totalCents = subtotalCents + tax;
  return {
    public: {
      title: input.title,
      company: input.company,
      clientName: input.clientName,
      address: input.address,
      sections,
      subtotalCents,
      taxCents: tax,
      totalCents,
      schedule: scheduleAmounts(totalCents, input.scheduleParts),
      termsVersion: input.termsVersion ?? CONSENT_VERSION,
      disclaimer: PROPOSAL_DISCLAIMER,
    },
    lines: internal,
  };
}

export function defaultSchedule(org: {
  depositBps: number;
  progressBps: number;
  finalBps: number;
  defaultDrawsJson?: string | null;
}) {
  const custom = parseDefaultDraws(org.defaultDrawsJson);
  if (custom && custom.reduce((sum, row) => sum + row.bps, 0) === 10000) {
    return custom.map((row, index) => ({
      type: index === 0 ? "deposit" : index === custom.length - 1 ? "final" : "progress",
      label: row.title,
      bps: row.bps,
    }));
  }
  return [
    { type: "deposit", label: "Deposit to schedule the job", bps: org.depositBps },
    { type: "progress", label: "Progress at rough-in", bps: org.progressBps },
    { type: "final", label: "Final on completion", bps: org.finalBps },
  ];
}
