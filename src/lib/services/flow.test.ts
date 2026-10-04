import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile } from "@/lib/db/client";
import { authenticate, askCopilot, estimateDetail, invoicesCsv, leadDetail, leadPhotoNames, listProjects, projectDetail, receivables } from "@/lib/services/read";
import {
  addCost,
  addManualLine,
  approveChangeOrder,
  approveDraft,
  createChangeOrder,
  createLeadFromText,
  declineProposal,
  generateEstimate,
  payInvoice,
  previewReceipt,
  reviseEstimate,
  saveUploadedText,
  sendChangeOrder,
  sendProposal,
  signProposal,
  updateLine,
} from "@/lib/services/write";
import { getDb } from "@/lib/db/client";
import { documents, payments, proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lineAmounts } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";

function linePrice(unitCostCents: number, markupBps: number) {
  return lineAmounts(1000, unitCostCents, markupBps).price;
}

beforeAll(() => {
  useDatabaseFile(":memory:");
});

describe("kitchen remodel through margin", () => {
  it("runs the seeded company and the live path", async () => {
    const maya = authenticate("maya@rivera.demo", "demo");
    const dana = authenticate("dana@rivera.demo", "demo");
    const jordan = authenticate("jordan@northline.demo", "demo");
    expect(maya?.orgName).toBe("Rivera Remodeling & Trade");
    expect(jordan).not.toBeNull();
    expect(authenticate("maya@rivera.demo", "nope")).toBeNull();

    expect(leadDetail(jordan!.orgId, "lead_vasquez")).toBeNull();
    expect(projectDetail(jordan!.orgId, "proj_brooks", "owner")).toBeNull();

    const fieldView = projectDetail(maya!.orgId, "proj_brooks", "field");
    expect(fieldView?.financials).toBeNull();
    expect(projectDetail(maya!.orgId, "proj_brooks", "owner")?.financials?.alert).toBe(true);

    const pasted = createLeadFromText(
      maya!,
      "Elena Vasquez, 240 sq ft kitchen, gut, new cabinets, quartz, 14 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights. Budget $60–80k. 240 Hillcrest Ave, Oakland.",
    );
    expect(pasted.intake.sqft).toBe(240);
    const generated = await generateEstimate(maya!, "lead_vasquez");
    const detail = leadDetail(maya!.orgId, "lead_vasquez");
    const estimateId = detail?.estimates.find((estimate) => estimate.id === generated.estimateId)?.id;
    expect(estimateId).toBeTruthy();

    const estimate = estimateDetail(maya!.orgId, generated.estimateId);
    expect(estimate!.priceCents).toBeGreaterThanOrEqual(6_000_000);
    expect(estimate!.priceCents).toBeLessThanOrEqual(8_500_000);
    expect(estimate!.estimate.notes).toMatch(/3 captions/);
    expect(estimate!.marginBps!).toBeGreaterThanOrEqual(estimate!.estimate.marginTargetBps);

    expect(() => updateLine(dana!, estimate!.lines[0].id, { qty: 1 })).toThrow(/cannot change prices/);

    const sent = await sendProposal(maya!, generated.estimateId);
    expect(sent.publicToken).toBeTruthy();
    expect(() => updateLine(maya!, estimate!.lines[0].id, { qty: 10 })).toThrow(/already sent/);
    const revised = reviseEstimate(maya!, generated.estimateId);
    expect(revised.estimateId).not.toBe(generated.estimateId);

    const signed = signProposal({
      token: sent.publicToken,
      signerName: "Elena Vasquez",
      typedName: "Elena Vasquez",
      consent: true,
      ip: "198.51.100.8",
      userAgent: "vitest",
    });
    expect(() =>
      signProposal({
        token: sent.publicToken,
        signerName: "Elena Vasquez",
        typedName: "Elena Vasquez",
        consent: true,
      }),
    ).toThrow(/already signed/);

    const paid = payInvoice({
      token: signed.payToken,
      method: "ach",
      routing: "110000000",
      account: "000123456789",
      idempotencyKey: "kitchen-deposit-1",
    });
    expect(paid.ok).toBe(true);
    const paymentRow = getDb().select().from(payments).where(eq(payments.id, paid.paymentId!)).get();
    expect(paymentRow?.stub).toBe(1);
    expect(paymentRow?.stripePaymentIntent?.startsWith("pi_mock_")).toBe(true);
    const again = payInvoice({
      token: signed.payToken,
      method: "ach",
      routing: "110000000",
      account: "000123456789",
      idempotencyKey: "kitchen-deposit-1",
    });
    expect(again.duplicate).toBe(true);
    expect(again.ok).toBe(true);

    const failed = payInvoice({
      token: "demo_pay_chen_deposit",
      method: "ach",
      routing: "110000000",
      account: "000222222227",
      idempotencyKey: "chen-nsf",
    });
    expect(failed.ok).toBe(false);

    const created = createChangeOrder(maya!, signed.projectId, {
      title: "Relocate plumbing wall",
      description: "Move the sink wall 2 feet.",
      name: "Relocate plumbing wall",
      qty: 1,
      unit: "ea",
      unitCostCents: 180000,
      markupBps: 3500,
      costCode: "PLB-SINK",
    });
    await sendChangeOrder(maya!, created.changeOrderId);
    const before = projectDetail(maya!.orgId, signed.projectId, "owner")!;
    approveChangeOrder({ token: created.publicToken, typedName: "Elena Vasquez", consent: true });
    const after = projectDetail(maya!.orgId, signed.projectId, "owner")!;
    const coPrice = linePrice(180000, 3500);
    expect(after.financials!.contractCents).toBe(before.financials!.contractCents + coPrice);
    expect(after.invoices.some((invoice) => invoice.type === "co" && invoice.status === "open")).toBe(true);

    const receipt = previewReceipt("Vendor: Casa Tile\nTotal $864.50");
    const posted = addCost(maya!, signed.projectId, {
      amountCents: receipt.amountCents!,
      vendorName: receipt.vendor!,
      costCode: "TILE-BACK",
      memo: "Backsplash materials",
      source: "receipt",
      aiExtracted: true,
    });
    expect(posted.marginBps).not.toBeNull();

    const owes = askCopilot(maya!.orgId, "Who owes me money?");
    const openSum = owes.rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0);
    const expected = receivables(maya!.orgId).reduce((sum, row) => sum + row.invoice.totalCents - row.invoice.amountPaidCents, 0);
    expect(openSum).toBe(expected);

    const margins = askCopilot(maya!.orgId, "Which jobs are under 20% margin?");
    expect(margins.rows.some((row) => row.label.includes("Brooks"))).toBe(true);
    const pipeline = askCopilot(maya!.orgId, "What's my pipeline value?");
    expect(pipeline.answer).toMatch(/open deals/);

    const follow = await approveDraft(maya!, "draft_briggs");
    expect(follow.stub).toBe(true);
    const briggs = leadDetail(maya!.orgId, "lead_briggs");
    expect(briggs?.messages.some((message) => message.direction === "out" && message.body.includes("deck"))).toBe(true);

    getDb().update(proposals).set({ expiresAt: new Date(Date.now() - 86_400_000).toISOString(), status: "viewed" }).where(eq(proposals.publicToken, "demo_proposal_briggs")).run();
    expect(() =>
      signProposal({ token: "demo_proposal_briggs", signerName: "Tom Briggs", typedName: "Tom Briggs", consent: true }),
    ).toThrow(/expired/);

    const jobs = listProjects(maya!.orgId);
    expect(jobs.length).toBeGreaterThanOrEqual(4);
  });

  it("declines a proposal once", async () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const created = createLeadFromText(maya, "Ruth Feldman, paint the exterior of a small house. $12k.");
    const estimate = await generateEstimate(maya, created.leadId);
    const sent = await sendProposal(maya, estimate.estimateId, true);
    declineProposal(sent.publicToken, "Going another direction");
    expect(() => declineProposal(sent.publicToken, "again")).toThrow(/already declined/);
    expect(() =>
      signProposal({ token: sent.publicToken, signerName: "Ruth Feldman", typedName: "Ruth Feldman", consent: true }),
    ).toThrow(/declined/);
  });

  it("rejects bad money, hides invoice exports, and keeps other companies' photos off the estimate", async () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const dana = authenticate("dana@rivera.demo", "demo")!;
    expect(() => invoicesCsv(maya.orgId)).not.toThrow();
    expect(invoicesCsv(maya.orgId)).toContain("InvoiceNo");
    expect(dana.role).toBe("field");
    expect(canSeeMoney(dana.role)).toBe(false);

    const created = createLeadFromText(maya, "Sam Ortiz, 80 sq ft hall bath, new tile and a vanity.");
    const generated = await generateEstimate(maya, created.leadId);
    const detail = estimateDetail(maya.orgId, generated.estimateId)!;
    expect(() => updateLine(maya, detail.lines[0].id, { qty: -3 })).toThrow(/Quantity/);
    expect(() => updateLine(maya, detail.lines[0].id, { unitCostCents: -1 })).toThrow(/Unit cost/);
    expect(() =>
      addManualLine(maya, generated.estimateId, {
        name: "Credit",
        qty: 1,
        unit: "ea",
        unitCostCents: -500,
        markupBps: 3500,
      }),
    ).toThrow(/Unit cost/);
    expect(() => addCost(maya, "proj_chen", { amountCents: -100, vendorName: "X", source: "expense" })).toThrow(/greater than zero/);
    expect(() => addCost(maya, "proj_chen", { amountCents: 2_000_000_000, vendorName: "X", source: "expense" })).toThrow(/\$10,000,000/);
    expect(() => saveUploadedText(maya, "proj_chen", "evil.svg", "<svg onload='alert(1)'></svg>")).toThrow(/txt or .csv/);

    getDb()
      .insert(documents)
      .values({
        id: "doc_foreign_photo",
        orgId: "org_northline",
        projectId: null,
        leadId: created.leadId,
        contactId: null,
        type: "photo",
        filename: "northline-secret-panel.svg",
        storagePath: "/demo/photos/diaz-deck.svg",
        metadataJson: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        createdBy: null,
      })
      .run();
    expect(leadPhotoNames(maya.orgId, created.leadId)).not.toContain("northline-secret-panel.svg");
    expect(leadPhotoNames("org_northline", created.leadId)).toContain("northline-secret-panel.svg");
  });
});
