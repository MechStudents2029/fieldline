import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { dailyLogs, documents, payments, projects } from "@/lib/db/schema";
import {
  depositPaidAt,
  finalInvoiceAt,
  needsYouAction,
  portalLogView,
  portalMoney,
  portalTimeline,
} from "@/lib/portal/summary";
import { portalByToken } from "@/lib/services/read";
import { addPortalMessage } from "@/lib/services/write";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

describe("portal summary math", () => {
  it("adds the signed proposal and approved change orders, and rounds to cents", () => {
    const money = portalMoney({
      proposalStatus: "signed",
      proposalTotalCents: 1001,
      orders: [
        { status: "approved", priceDeltaCents: 1001 },
        { status: "approved", priceDeltaCents: -400 },
        { status: "declined", priceDeltaCents: 5000 },
        { status: "void", priceDeltaCents: 9000 },
        { status: "sent", priceDeltaCents: 96000 },
        { status: "draft", priceDeltaCents: 100 },
      ],
      payments: [
        { status: "succeeded", amountCents: 500 },
        { status: "succeeded", amountCents: 25 },
        { status: "failed", amountCents: 8000 },
        { status: "processing", amountCents: 100 },
      ],
    });
    expect(money).toEqual({ contractCents: 1602, paidCents: 525, balanceCents: 1077 });

    const rounded = portalMoney({
      proposalStatus: "signed",
      proposalTotalCents: 10.6,
      orders: [{ status: "approved", priceDeltaCents: 10.6 }],
      payments: [{ status: "succeeded", amountCents: 10.4 }],
    });
    expect(rounded).toEqual({ contractCents: 22, paidCents: 10, balanceCents: 12 });
    expect(Number.isInteger(rounded.contractCents)).toBe(true);
  });

  it("ignores an unsigned proposal", () => {
    expect(
      portalMoney({
        proposalStatus: "sent",
        proposalTotalCents: 5000,
        orders: [{ status: "approved", priceDeltaCents: 200 }],
        payments: [],
      }),
    ).toEqual({ contractCents: 200, paidCents: 0, balanceCents: 200 });
  });
});

describe("portal timeline", () => {
  it("keeps only steps that have a real date", () => {
    expect(
      portalTimeline({
        signedAt: null,
        depositPaidAt: null,
        logDates: [],
        finalInvoiceAt: null,
      }),
    ).toEqual([]);

    expect(
      portalTimeline({
        signedAt: "2026-09-09T15:00:00.000Z",
        depositPaidAt: "2026-09-11T15:00:00.000Z",
        logDates: ["2026-10-05"],
        finalInvoiceAt: null,
      }).map((step) => step.id),
    ).toEqual(["signed", "deposit", "started"]);

    const twoLogs = portalTimeline({
      signedAt: "2026-09-09T15:00:00.000Z",
      depositPaidAt: null,
      logDates: ["2026-10-05", "2026-10-01"],
      finalInvoiceAt: "2026-10-06",
    });
    expect(twoLogs.map((step) => step.label)).toEqual(["Signed", "Work started", "Latest update", "Final invoice"]);
    expect(twoLogs.find((step) => step.id === "started")?.date).toBe("2026-10-01");
    expect(twoLogs.find((step) => step.id === "latest")?.date).toBe("2026-10-05");
  });

  it("does not invent a deposit or final date", () => {
    expect(depositPaidAt({ invoices: [{ id: "inv", type: "deposit" }], payments: [] })).toBeNull();
    expect(
      depositPaidAt({
        invoices: [{ id: "inv", type: "progress" }],
        payments: [{ invoiceId: "inv", status: "succeeded", createdAt: "2026-10-01T00:00:00.000Z" }],
      }),
    ).toBeNull();
    expect(finalInvoiceAt([{ type: "progress", status: "open", issueDate: "2026-10-01" }])).toBeNull();
    expect(finalInvoiceAt([{ type: "final", status: "void", issueDate: "2026-10-01" }])).toBeNull();
    expect(finalInvoiceAt([{ type: "final", status: "open", issueDate: "2026-10-02" }])).toBe("2026-10-02");
  });

  it("asks for the change order before an open invoice, and for nothing when nothing is due", () => {
    expect(
      needsYouAction({
        orders: [
          { id: "approved", status: "approved" },
          { id: "sent", status: "sent" },
        ],
        invoices: [{ id: "open", status: "open", issueDate: "2026-10-01" }],
      }),
    ).toEqual({ kind: "change-order", id: "sent" });
    expect(
      needsYouAction({
        orders: [{ id: "approved", status: "approved" }],
        invoices: [
          { id: "later", status: "open", issueDate: "2026-10-06" },
          { id: "paid", status: "paid", issueDate: "2026-09-01" },
          { id: "first", status: "open", issueDate: "2026-10-01" },
        ],
      }),
    ).toEqual({ kind: "invoice", id: "first" });
    expect(needsYouAction({ orders: [{ id: "draft", status: "draft" }], invoices: [] })).toBeNull();
  });

  it("drops internal log fields from the homeowner view", () => {
    expect(
      portalLogView({
        id: "log",
        logDate: "2026-10-05",
        notes: "Set the niche.",
        plannedNext: "Grout",
        photos: [{ id: "doc", caption: "Niche" }],
        delayCause: "Inspector",
        safetyNote: "Wet floor",
        authorName: "Dana",
        weatherSky: "Clear",
        deliveries: "Tile",
        visitors: "Inspector",
      }),
    ).toEqual({
      id: "log",
      logDate: "2026-10-05",
      notes: "Set the niche.",
      plannedNext: "Grout",
      photos: [{ id: "doc", caption: "Niche" }],
    });
  });
});

describe("portal isolation", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
    getDb()
      .insert(projects)
      .values({
        id: "proj_north_home",
        orgId: "org_northline",
        leadId: null,
        proposalId: null,
        contactId: "c_north_ada",
        name: "Ada charger",
        status: "active",
        address: "3 Virginia St",
        contractValueCents: 100_000,
        originalContractCents: 100_000,
        startDate: null,
        endDate: null,
        portalToken: "demo_portal_north_home",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        createdBy: "user_jordan",
      })
      .run();
    getDb()
      .insert(dailyLogs)
      .values({
        id: "log_north_secret",
        orgId: "org_northline",
        projectId: "proj_north_home",
        authorId: "user_jordan",
        logDate: "2020-01-01",
        status: "published",
        visibility: "client",
        notes: "Northline client note",
        plannedNext: null,
        weatherSky: null,
        weatherHighF: null,
        weatherLowF: null,
        weatherLostMinutes: null,
        weatherImpact: null,
        delayCause: "Northline secret delay",
        delayMinutes: 30,
        deliveries: null,
        visitors: null,
        safetyNote: "Northline hazard",
        publishedAt: "2020-01-01T00:00:00.000Z",
        voidReason: null,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      })
      .run();
    getDb()
      .insert(payments)
      .values({
        id: "pay_cross_org",
        orgId: "org_northline",
        invoiceId: "inv_ok_dep",
        method: "ach",
        amountCents: 999,
        feeCents: 0,
        netCents: 999,
        status: "succeeded",
        stripePaymentIntent: null,
        idempotencyKey: "cross_org_payment",
        failureReason: null,
        stub: 1,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      })
      .run();
  });

  it("keeps internal log fields and another company off the portal", () => {
    const portal = portalByToken("demo_portal_okonkwo");
    expect(portal?.project.orgId).toBe("org_rivera");
    const packed = JSON.stringify(portal);
    expect(packed).not.toContain("delayCause");
    expect(packed).not.toContain("safetyNote");
    expect(packed).not.toContain("costDelta");
    expect(packed).not.toContain("costCents");
    expect(packed).not.toContain("Waited on the inspector");
    expect(packed).not.toContain("Wet floor");
    expect(packed).not.toContain("Dana Cho");
    expect(packed).not.toContain("user_dana");
    expect(packed).not.toContain("5200");
    expect(packed).not.toContain("Framed the west wall");
    expect(packed).not.toContain("Northline");
    expect(packed).not.toContain("doc_o2");
    expect(packed).not.toContain("org_northline");
    expect(packed).toContain("kept the niche dry");
    expect(portal?.logs.every((log) => !("delayCause" in log) && !("safetyNote" in log))).toBe(true);
    expect(portal?.orders.every((order) => order.orgId === "org_rivera")).toBe(true);
    expect(portal?.invoices.every((invoice) => invoice.orgId === "org_rivera")).toBe(true);
    expect(portal?.payments.every((payment) => payment.orgId === "org_rivera")).toBe(true);
    expect(portal?.payments.some((payment) => payment.id === "pay_cross_org")).toBe(false);

    const money = portalMoney({
      proposalStatus: portal?.proposal?.status ?? null,
      proposalTotalCents: portal?.proposal?.totalCents ?? null,
      orders: portal?.orders ?? [],
      payments: portal?.payments ?? [],
    });
    expect(money).toEqual({ contractCents: 4_620_000, paidCents: 1_680_000, balanceCents: 2_940_000 });
    expect(portal?.orders.some((order) => order.status === "sent" && order.priceDeltaCents === 96000)).toBe(true);

    const steps = portalTimeline({
      signedAt: portal?.proposal?.signedAt ?? null,
      depositPaidAt: depositPaidAt({ invoices: portal?.invoices ?? [], payments: portal?.payments ?? [] }),
      logDates: (portal?.logs ?? []).map((log) => log.logDate),
      finalInvoiceAt: finalInvoiceAt(portal?.invoices ?? []),
    });
    expect(steps.map((step) => step.id)).toEqual(["signed", "deposit", "started"]);
    expect(steps.find((step) => step.id === "signed")?.date).toBe(portal?.proposal?.signedAt);
    expect(steps.some((step) => step.id === "final")).toBe(false);

    const north = portalByToken("demo_portal_north_home");
    expect(north?.project.orgId).toBe("org_northline");
    const northPacked = JSON.stringify(north);
    expect(northPacked).toContain("Northline client note");
    expect(northPacked).not.toContain("Northline secret delay");
    expect(northPacked).not.toContain("Northline hazard");
    expect(northPacked).not.toContain("delayCause");
    expect(northPacked).not.toContain("safetyNote");
    expect(northPacked).not.toContain("kept the niche dry");
    expect(northPacked).not.toContain("org_rivera");
    expect(north?.invoices).toEqual([]);
    expect(portalByToken("not-a-real-token")).toBeNull();
  });

  it("stores a portal photo on that job only", () => {
    addPortalMessage("demo_portal_okonkwo", "The niche looks good.", { filename: "niche.png", bytes: png });
    const portal = portalByToken("demo_portal_okonkwo");
    const photo = portal?.messagePhotos[0];
    expect(photo?.messageId).toBeTruthy();
    const doc = getDb().select().from(documents).where(eq(documents.id, photo!.id)).get();
    expect(doc?.orgId).toBe("org_rivera");
    expect(doc?.projectId).toBe("proj_okonkwo");
    expect(doc?.storagePath.endsWith(".svg")).toBe(false);
    expect(portalByToken("demo_portal_north_home")?.messagePhotos).toEqual([]);
    expect(() => addPortalMessage("demo_portal_okonkwo", "Skip this", { filename: "note.svg", bytes: png })).toThrow(/JPEG|PNG|WebP/);
    expect(() => addPortalMessage("missing-portal-token", "Hello")).toThrow(/not found/);
  });
});
