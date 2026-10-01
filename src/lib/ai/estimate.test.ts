import { describe, expect, it } from "vitest";
import { draftEstimate, draftToTotals } from "@/lib/ai/estimate";
import { extractIntake } from "@/lib/ai/intake";
import { extractReceiptText } from "@/lib/ai/receipt";
import { routeCopilotQuestion, marginThresholdFromQuestion } from "@/lib/ai/copilot";
import { needsProposalNudge } from "@/lib/ai/nurture";
import { riveraCatalog } from "@/lib/db/catalog";
import { lineAmounts, qtyToMilli } from "@/lib/money";
import { decideAch, decideCard } from "@/lib/payments/decide";

const SCOPE =
  "Elena Vasquez, 240 sq ft kitchen, gut, new cabinets, quartz, 14 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights. Budget $60–80k.";

describe("intake and estimate", () => {
  it("reads the kitchen paste", () => {
    const intake = extractIntake(SCOPE);
    expect(intake.name).toBe("Elena Vasquez");
    expect(intake.sqft).toBe(240);
    expect(intake.valueLowCents).toBe(6_000_000);
    expect(intake.valueHighCents).toBe(8_000_000);
    expect(intake.projectType).toBe("Kitchen remodel");
  });

  it("prices the kitchen from the price book inside the named budget", () => {
    const draft = draftEstimate({
      scope: SCOPE,
      photoNames: ["vasquez-cabinets.svg", "vasquez-floor.svg", "vasquez-sink.svg"],
      book: riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 })),
      markupBps: 3500,
    });
    const totals = draftToTotals(draft, lineAmounts, qtyToMilli);
    expect(totals.price).toBeGreaterThanOrEqual(6_000_000);
    expect(totals.price).toBeLessThanOrEqual(8_500_000);
    expect(draft.sections.some((section) => section.lines.some((line) => line.confidence < 0.7))).toBe(true);
    const cabinets = draft.sections.flatMap((section) => section.lines).find((line) => line.code === "CAB-BASE");
    expect(cabinets?.qty).toBe(14);
    expect(cabinets?.unitCostCents).toBe(62_000);
  });

  it("reads a receipt total", () => {
    const extracted = extractReceiptText("Vendor: Casa Tile\nBacksplash tile\nTotal $864.50");
    expect(extracted.vendor).toContain("Casa Tile");
    expect(extracted.amountCents).toBe(86450);
    expect(extracted.confidence).toBeGreaterThan(0.7);
  });
});

describe("copilot routing and payments", () => {
  it("routes questions to typed tools", () => {
    expect(routeCopilotQuestion("Who owes me money?")).toBe("receivables");
    expect(routeCopilotQuestion("Which jobs are under 20% margin?")).toBe("job_margins");
    expect(marginThresholdFromQuestion("under 15% margin", 2000)).toBe(1500);
    expect(routeCopilotQuestion("What's my pipeline value?")).toBe("pipeline");
    expect(routeCopilotQuestion("Which proposals are unsigned?")).toBe("overdue_proposals");
    expect(routeCopilotQuestion("Write a poem")).toBeNull();
  });

  it("matches Stripe test accounts and cards", () => {
    expect(decideAch("110000000", "000123456789").ok).toBe(true);
    expect(decideAch("110000000", "000222222227").ok).toBe(false);
    expect(decideCard("4242424242424242", "12/30", "123").ok).toBe(true);
    expect(decideCard("4000000000000002", "12/30", "123").ok).toBe(false);
  });

  it("nudges unsigned proposals after three days", () => {
    const sent = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(needsProposalNudge("viewed", sent)).toBe(true);
    expect(needsProposalNudge("signed", sent)).toBe(false);
  });
});
