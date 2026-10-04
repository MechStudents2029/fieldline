import { describe, expect, it } from "vitest";
import { draftEstimate, draftToTotals, PHOTO_ONLY_CONFIDENCE_CAP } from "@/lib/ai/estimate";
import { estimateFromScope, gatewayEstimatePrompt } from "@/lib/ai/gateway";
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
    expect(cabinets?.reason).not.toMatch(/site measure/i);
  });

  it("caps a caption-only photo cue and asks for a site check", () => {
    const book = riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 }));
    const draft = draftEstimate({
      scope: "Repaint the hall closet.",
      photos: [{ filename: "site.jpg", caption: "tile shower" }],
      book,
      markupBps: 3500,
    });
    const shower = draft.sections.flatMap((section) => section.lines).find((line) => line.code === "TILE-SHOWER");
    expect(shower).toBeTruthy();
    expect(shower!.confidence).toBeLessThanOrEqual(PHOTO_ONLY_CONFIDENCE_CAP);
    expect(shower!.reason).toMatch(/site photo/i);
    expect(shower!.reason).toMatch(/site check/i);
    expect(shower!.reason).toMatch(/site measure/i);
    expect(shower!.qty).toBe(80);
  });

  it("treats cleaned filename tokens as photo context", () => {
    const draft = draftEstimate({
      scope: "Paint the bedroom.",
      photoNames: ["photos/backsplash-tile.jpg"],
      book: riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 })),
      markupBps: 3500,
    });
    const tile = draft.sections.flatMap((section) => section.lines).find((line) => line.code === "TILE-BACK");
    expect(tile?.confidence).toBeLessThanOrEqual(PHOTO_ONLY_CONFIDENCE_CAP);
    expect(tile?.reason).toMatch(/site photo/i);
  });

  it("raises confidence when the caption and the scope agree", () => {
    const book = riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 }));
    const photoOnly = draftEstimate({
      scope: "Repaint the hall closet.",
      photos: [{ filename: "site.jpg", caption: "tile shower" }],
      book,
      markupBps: 3500,
    });
    const agreed = draftEstimate({
      scope: "New tile shower, 60 sq ft bath.",
      photos: [{ filename: "shower-tile.svg", caption: "tile shower walls" }],
      book,
      markupBps: 3500,
    });
    const only = photoOnly.sections.flatMap((section) => section.lines).find((line) => line.code === "TILE-SHOWER");
    const both = agreed.sections.flatMap((section) => section.lines).find((line) => line.code === "TILE-SHOWER");
    expect(both!.confidence).toBeGreaterThan(only!.confidence);
    expect(both!.reason).not.toMatch(/site photo/i);
  });

  it("ignores dimensions that appear only in a caption", () => {
    const draft = draftEstimate({
      scope: "Paint the closet.",
      photos: [{ filename: "wide.jpg", caption: "gut the 900 sq ft kitchen" }],
      book: riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 })),
      markupBps: 3500,
    });
    const demo = draft.sections.flatMap((section) => section.lines).find((line) => line.code === "DEMO-GUT");
    expect(demo?.qty).toBe(1);
    expect(demo?.confidence).toBeLessThanOrEqual(PHOTO_ONLY_CONFIDENCE_CAP);
  });

  it("asks for a site measure when cabinet length was inferred", () => {
    const book = riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 }));
    const draft = draftEstimate({
      scope: "New cabinets in the kitchen.",
      book,
      markupBps: 3500,
    });
    const base = draft.sections.flatMap((section) => section.lines).find((line) => line.code === "CAB-BASE");
    expect(base?.reason).toMatch(/site measure/i);
    expect(draft.notes).toMatch(/site measure/i);
  });

  it("leaves an empty photo list the same as no photos", () => {
    const book = riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 }));
    const omitted = draftEstimate({ scope: SCOPE, book, markupBps: 3500 });
    const names = draftEstimate({ scope: SCOPE, photoNames: [], book, markupBps: 3500 });
    const photos = draftEstimate({ scope: SCOPE, photos: [], book, markupBps: 3500 });
    expect(names).toEqual(omitted);
    expect(photos).toEqual(omitted);
  });

  it("keeps the gateway on the local matcher and names captions in the prompt", async () => {
    const previous = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    const book = riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 }));
    const draft = await estimateFromScope({
      scope: "Repaint the hall closet.",
      photos: [{ filename: "site.jpg", caption: "tile shower" }],
      book,
      markupBps: 3500,
    });
    expect(draft.model).toBe("fieldline-pricebook-v1");
    const prompt = gatewayEstimatePrompt({
      scope: "Repaint the hall closet.",
      book,
      photos: [{ filename: "site.jpg", caption: "tile shower" }],
    });
    expect(prompt).toContain("site.jpg — tile shower");
    expect(prompt).toContain("Do not invent codes or prices.");
    expect(prompt).not.toContain("image bytes");
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
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

  it("nudges a viewed proposal sooner than one that was never opened", () => {
    const twoDays = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const fourDays = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(needsProposalNudge("viewed", twoDays, Date.now(), twoDays)).toBe(true);
    expect(needsProposalNudge("sent", twoDays)).toBe(false);
    expect(needsProposalNudge("sent", fourDays)).toBe(true);
    expect(needsProposalNudge("signed", fourDays)).toBe(false);
    expect(needsProposalNudge("declined", fourDays)).toBe(false);
  });
});
