import { CONSENT_VERSION, PROPOSAL_DISCLAIMER } from "@/lib/product";
import { formatQty, lineAmounts, scheduleAmounts, taxCents } from "@/lib/money";

export type SnapshotLineInput = {
  name: string;
  qtyMilli: number;
  unit: string;
  unitCostCents: number;
  markupBps: number;
  costCode: string | null;
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
  const sections = input.sections.map((section) => ({
    name: section.name,
    lines: section.lines.map((line) => {
      const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
      internal.push({
        name: line.name,
        costCode: line.costCode,
        costCents: amounts.cost,
        priceCents: amounts.price,
        qtyMilli: line.qtyMilli,
        unit: line.unit,
      });
      const qty = line.qtyMilli / 1000;
      const unitPriceCents = qty === 0 ? 0 : Math.round(amounts.price / qty);
      return {
        name: line.name,
        qty: formatQty(line.qtyMilli),
        unit: line.unit,
        unitPriceCents,
        priceCents: amounts.price,
      };
    }),
  }));

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
}) {
  return [
    { type: "deposit", label: "Deposit to schedule the job", bps: org.depositBps },
    { type: "progress", label: "Progress at rough-in", bps: org.progressBps },
    { type: "final", label: "Final on completion", bps: org.finalBps },
  ];
}
