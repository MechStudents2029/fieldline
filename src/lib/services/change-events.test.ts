import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { changeOrderLines, changeOrders, messages, notifications, projects, purchaseOrderLines, purchaseOrders } from "@/lib/db/schema";
import { lineAmounts } from "@/lib/money";
import { mentionUnread } from "@/lib/services/comments";
import {
  askChangeQuote,
  changeEventAttention,
  changeEventDetail,
  changeEventsCsv,
  chooseChangeQuote,
  convertChangeEvent,
  copyChangeQuote,
  createChangeEvent,
  listChangeEvents,
  markChangeReady,
  markChangeRequested,
  portalChangeQuotesForClient,
  portalChangeQuotesForVendor,
  submitChangeQuote,
  voidChangeEvent,
} from "@/lib/services/change-events";
import { ServiceError } from "@/lib/services/errors";
import { authenticate, projectDetail } from "@/lib/services/read";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("change events", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the new tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["change_events", "change_event_codes", "change_event_quotes", "change_event_files", "change_event_commitments"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
  });

  it("seeds an aged open event, two vendor prices, and one conversion", () => {
    const maya = actor("maya@rivera.demo");
    const attention = changeEventAttention(maya);
    expect(attention.age).toEqual({ count: 1, href: "/change-events?filter=age" });
    expect(attention.due).toEqual({ count: 1, href: "/change-events?filter=due" });
    expect(listChangeEvents(maya, { filter: "age" }).map((row) => row.title)).toEqual(["Valve height gap"]);
    expect(listChangeEvents(maya, { filter: "open" }).map((row) => row.title)).toEqual(["Valve height gap"]);
    const priced = changeEventDetail(maya, "ce_ok_prices");
    expect(priced?.quotes.map((row) => [row.vendor, row.status, row.amountCents])).toEqual([
      ["Casa Tile", "requested", null],
      ["Harbor Plumbing", "priced", 48_000],
    ]);
    expect(priced?.files.map((row) => row.filename)).toEqual(["a101-floor-plan.pdf"]);
    expect(changeEventDetail(maya, "ce_ok_rfi")).toMatchObject({ sourceKind: "rfi", sourceId: "rfi_ok_valve", sourceLabel: "RFI 1" });
    const converted = changeEventDetail(maya, "ce_chen_conv");
    expect(converted?.status).toBe("converted");
    expect(converted?.changeOrderNumber).toBe(1);
    expect(converted?.commitments.map((row) => row.number)).toEqual(["PO-1043"]);
    expect(getDb().select().from(changeOrders).where(eq(changeOrders.id, "co_chen_ce")).get()?.status).toBe("draft");
    expect(getDb().select().from(purchaseOrders).where(eq(purchaseOrders.id, "po_chen_ce")).get()?.status).toBe("draft");
    expect(portalChangeQuotesForVendor(DEMO_HARBOR_PORTAL_TOKEN).map((row) => row.title)).toEqual(["Niche tile extra"]);
    expect(portalChangeQuotesForVendor(DEMO_HARBOR_PORTAL_TOKEN).some((row) => row.scope.includes("DEMO-GUT"))).toBe(true);
    expect(portalChangeQuotesForVendor("nope")).toEqual([]);
    expect(portalChangeQuotesForClient("demo_portal_okonkwo")).toEqual([]);
    expect(changeEventDetail(actor("jordan@northline.demo"), "ce_ok_rfi")).toBeNull();
    expect(changeEventDetail(actor("dana@rivera.demo"), "ce_ok_rfi")?.showMoney).toBe(false);
    expect(mentionUnread(maya)).toBe(2);
    const glass = projectDetail("org_rivera", "proj_okonkwo", "owner")?.financials?.byCode.find((row) => row.code === "BATH-GLASS");
    expect(glass).toMatchObject({ budgetCents: 320_000, actualCents: 0, pendingCents: 22_000, projectedCents: 342_000, exposureCents: 0, level: "ok" });
    const demo = projectDetail("org_rivera", "proj_okonkwo", "owner")?.financials?.byCode.find((row) => row.code === "DEMO-GUT");
    expect(demo).toMatchObject({ pendingCents: 15_000, actualCents: 0 });
    expect(demo?.projectedCents).toBe(Math.max(demo?.budgetCents ?? 0, demo?.exposureCents ?? 0) + 15_000);
    expect(projectDetail("org_rivera", "proj_okonkwo", "owner")?.financials?.byCode.find((row) => row.code === "PLB-SHOWER")).toMatchObject({
      pendingCents: 0,
      projectedCents: 812_000,
      actualCents: 362_000,
    });
    expect(projectDetail("org_rivera", "proj_chen", "owner")?.financials?.byCode.find((row) => row.code === "TILE-FLR")?.pendingCents).toBe(0);
    expect(changeEventsCsv(maya)).toContain("Valve height gap");
    expect(changeEventsCsv(actor("dana@rivera.demo"))).not.toContain("310.00");
  });

  it("lets field log an event and keeps office on the convert path", () => {
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const maya = actor("maya@rivera.demo");
    const beforeMessages = getDb().select().from(messages).all().length;
    const beforeNotes = getDb().select().from(notifications).all().length;
    expect(() => createChangeEvent(riley, "proj_okonkwo", { title: "Viewer extra", reason: "field", costCode: "BATH-GLASS" })).toThrow(ServiceError);
    const eventId = createChangeEvent(dana, "proj_okonkwo", { title: "Field niche", reason: "field", costCode: "BATH-GLASS" });
    expect(changeEventDetail(maya, eventId)?.status).toBe("open");
    expect(() => askChangeQuote(dana, eventId, "c_harbor", "2026-12-01")).toThrow(/role/i);
    expect(() => markChangeReady(dana, eventId)).toThrow(/role/i);
    expect(() => convertChangeEvent(dana, eventId)).toThrow(/role/i);
    expect(() => voidChangeEvent(dana, eventId, "No")).toThrow(/role/i);
    expect(() => createChangeEvent(maya, "proj_chen", { title: "Wrong source", reason: "design", costCode: "TILE-FLR", sourceKind: "rfi", sourceId: "rfi_ok_valve" })).toThrow(/source/i);
    expect(() => convertChangeEvent(maya, eventId)).toThrow(/ready/i);
    expect(() => voidChangeEvent(maya, eventId, "  ")).toThrow(/reason/i);
    voidChangeEvent(maya, eventId, "Duplicate of the niche");
    expect(changeEventDetail(maya, eventId)?.status).toBe("voided");
    expect(changeEventDetail(maya, eventId)?.voidReason).toBe("Duplicate of the niche");
    expect(getDb().select().from(messages).all().length).toBe(beforeMessages);
    expect(getDb().select().from(notifications).all().length).toBe(beforeNotes);
    expect(mentionUnread(maya)).toBe(2);
  });

  it("prices a vendor, converts once into a draft change order and commitment, and refuses a second convert", () => {
    const maya = actor("maya@rivera.demo");
    const luis = actor("luis@rivera.demo");
    getDb().update(projects).set({ markupBps: 5000 }).where(eq(projects.id, "proj_okonkwo")).run();
    const eventId = createChangeEvent(maya, "proj_okonkwo", {
      title: "Glass upcharge",
      reason: "owner",
      costCode: "BATH-GLASS",
      romCostCents: 10_000,
      romPriceCents: 18_000,
      scheduleDays: 2,
    });
    const quoteId = askChangeQuote(maya, eventId, "c_harbor", "2026-12-01");
    const url = copyChangeQuote(maya, quoteId);
    expect(url).toContain(DEMO_HARBOR_PORTAL_TOKEN);
    expect(changeEventDetail(maya, eventId)?.quotes[0]?.copiedAt).toBeTruthy();
    expect(portalChangeQuotesForVendor(DEMO_HARBOR_PORTAL_TOKEN).some((row) => row.title === "Glass upcharge")).toBe(false);
    markChangeRequested(maya, quoteId);
    expect(changeEventDetail(maya, eventId)?.status).toBe("pricing");
    expect(portalChangeQuotesForVendor(DEMO_HARBOR_PORTAL_TOKEN).some((row) => row.title === "Glass upcharge")).toBe(true);
    expect(portalChangeQuotesForVendor("demo_vendor_brighton_k4n2p9qx").some((row) => row.title === "Glass upcharge")).toBe(false);
    submitChangeQuote({ token: DEMO_HARBOR_PORTAL_TOKEN, quoteId, amountCents: 10_000, days: 3, note: "Tempered" });
    expect(() => submitChangeQuote({ token: DEMO_HARBOR_PORTAL_TOKEN, quoteId, amountCents: 11_000, days: 1, note: "Again" })).toThrow(/not here/i);
    chooseChangeQuote(luis, quoteId);
    markChangeReady(luis, eventId);
    const converted = convertChangeEvent(luis, eventId);
    const order = getDb().select().from(changeOrders).where(eq(changeOrders.id, converted.changeOrderId)).get();
    const expected = lineAmounts(1000, 10_000, 5000);
    expect(order).toMatchObject({ status: "draft", title: "Glass upcharge", priceDeltaCents: expected.price, costDeltaCents: expected.cost, sentAt: null });
    const lines = getDb().select().from(changeOrderLines).where(eq(changeOrderLines.changeOrderId, converted.changeOrderId)).all();
    expect(lines).toMatchObject([{ costCode: "BATH-GLASS", priceCents: expected.price, unitCostCents: expected.cost }]);
    expect(converted.purchaseOrderIds).toHaveLength(1);
    const po = getDb().select().from(purchaseOrders).where(eq(purchaseOrders.id, converted.purchaseOrderIds[0]!)).get();
    expect(po).toMatchObject({ status: "draft", vendorContactId: "c_harbor", changeOrderId: converted.changeOrderId, projectId: "proj_okonkwo" });
    expect(po?.number).toMatch(/^PO-\d+$/);
    expect(getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po!.id)).all()).toMatchObject([
      { costCode: "BATH-GLASS", amountCents: expected.cost },
    ]);
    const detail = changeEventDetail(maya, eventId);
    expect(detail?.status).toBe("converted");
    expect(detail?.changeOrderId).toBe(converted.changeOrderId);
    expect(detail?.commitments.map((row) => row.id)).toEqual(converted.purchaseOrderIds);
    expect(() => convertChangeEvent(maya, eventId)).toThrow(/converted/i);
    expect(() => markChangeReady(maya, eventId)).toThrow(/locked/i);
    expect(() => voidChangeEvent(maya, eventId, "Too late")).toThrow(/locked/i);
    getDb().update(projects).set({ markupBps: 0 }).where(eq(projects.id, "proj_okonkwo")).run();
    expect(projectDetail("org_rivera", "proj_okonkwo", "owner")?.financials?.byCode.find((row) => row.code === "PLB-SHOWER")?.projectedCents).toBe(812_000);
    const romId = createChangeEvent(maya, "proj_chen", { title: "ROM only", reason: "unforeseen", costCode: "TILE-FLR", romCostCents: 5_000, romPriceCents: 9_000 });
    markChangeReady(maya, romId);
    const rom = convertChangeEvent(maya, romId);
    expect(rom.purchaseOrderIds).toEqual([]);
    expect(getDb().select().from(changeOrders).where(eq(changeOrders.id, rom.changeOrderId)).get()).toMatchObject({
      status: "draft",
      priceDeltaCents: 9_000,
      costDeltaCents: 5_000,
    });
    expect(getDb().select().from(changeOrderLines).where(and(eq(changeOrderLines.changeOrderId, rom.changeOrderId), eq(changeOrderLines.costCode, "TILE-FLR"))).get()?.priceCents).toBe(9_000);
  });
});
