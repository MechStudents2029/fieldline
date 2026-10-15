import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bidInvites, bidLines, bidPlugs, bidPrices, bidRequests, budgetLines, purchaseOrderLines, purchaseOrders } from "@/lib/db/schema";
import { addCalendarDays, localDay } from "@/lib/time/calendar";
import { authenticate, portalByToken } from "@/lib/services/read";
import { rotateVendorPortal, setVendorCompliance } from "@/lib/services/vendor-portal";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import {
  awardBid,
  bidComparison,
  saveBidPlug,
  bidComposer,
  bidQueues,
  closeBid,
  createBid,
  declineVendorBid,
  saveBidLines,
  submitVendorBid,
  vendorBidPortal,
} from "@/lib/services/bids";

const ip = "198.51.100.40";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function lineId(bidId: string) {
  const line = getDb().select().from(bidLines).where(and(eq(bidLines.bidId, bidId), eq(bidLines.orgId, "org_rivera"))).get();
  if (!line) throw new Error("missing line");
  return line.id;
}

describe("bids", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps bid prices behind the money policy and leaves the request itself visible to members", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const money = sql.slice(sql.lastIndexOf("foreach tbl in array array["));
    expect(money).toContain("'bid_prices'");
    expect(money).toContain("'bid_awards'");
    expect(money).toContain("'bid_plugs'");
    expect(money).not.toContain("'bid_requests'");
    expect(sql).toContain("'bid_requests'");
  });

  it("seeds an open comparison with a low price on each line and hides other vendors from the portal", () => {
    const board = bidComparison(actor("maya@rivera.demo"), "bid_ok_valve");
    expect(board?.statusLabel).toBe("2 of 3 in");
    expect(board?.showMoney).toBe(true);
    const harbor = board?.vendors.find((row) => row.name === "Harbor Plumbing");
    const casa = board?.vendors.find((row) => row.name === "Casa Tile");
    const brighton = board?.vendors.find((row) => row.name === "Brighton Electric");
    expect(harbor?.prices.find((row) => row.lineId === "bln_ok_plb")).toMatchObject({ low: true, amountCents: 480_000, varianceCents: -40_000 });
    expect(casa?.prices.find((row) => row.lineId === "bln_ok_glass")?.low).toBe(true);
    expect(harbor?.prices.find((row) => row.lineId === "bln_ok_glass")).toMatchObject({
      low: false,
      noBid: true,
      amountCents: null,
      missing: true,
      plugCents: 360_000,
      plugNote: "Glass allowance",
      leftOpen: false,
    });
    expect(harbor?.totalCents).toBe(480_000);
    expect(harbor?.leveledCents).toBe(840_000);
    expect(harbor?.incomplete).toBe(false);
    expect(casa?.totalCents).toBe(900_000);
    expect(casa?.leveledCents).toBe(900_000);
    expect(casa?.incomplete).toBe(false);
    expect(brighton?.status).toBe("invited");
    expect(brighton?.totalCents).toBeNull();
    expect(brighton?.leveledCents).toBeNull();
    expect(brighton?.incomplete).toBe(true);
    expect(harbor?.compliance.state).toBe("missing");
    expect(bidQueues("org_rivera")).toEqual({
      due: { count: 1, href: "/bids/bid_ok_valve" },
      award: { count: 1, href: "/bids/bid_ok_valve" },
    });
    const harborJson = JSON.stringify(vendorBidPortal(DEMO_HARBOR_PORTAL_TOKEN));
    expect(harborJson).toContain("Shower plumbing and glass");
    expect(harborJson).not.toContain("610000");
    expect(harborJson).not.toContain("290000");
    expect(harborJson).not.toContain("Casa");
    expect(harborJson).not.toContain("Brighton");
    expect(harborJson).not.toContain("Amara");
    expect(harborJson).not.toContain("520000");
    expect(harborJson).not.toContain("4620000");
    expect(harborJson).not.toContain("margin");
    expect(harborJson).not.toContain("360000");
    expect(harborJson).not.toContain("Glass allowance");
    const casaToken = rotateVendorPortal(actor("maya@rivera.demo"), "c_casa");
    const casaJson = JSON.stringify(vendorBidPortal(casaToken));
    expect(casaJson).not.toContain("480000");
    expect(casaJson).not.toContain("360000");
    expect(casaJson).not.toContain("Glass allowance");
    expect(bidComparison(actor("jordan@northline.demo"), "bid_ok_valve")).toBeNull();
    expect(vendorBidPortal("demo_portal_okonkwo")).toBeNull();
    const field = bidComparison(actor("dana@rivera.demo"), "bid_ok_valve");
    expect(field?.showMoney).toBe(false);
    expect(JSON.stringify(field)).not.toContain("unitPriceCents");
    expect(JSON.stringify(field)).not.toContain("480000");
    expect(JSON.stringify(field)).not.toContain("520000");
    expect(JSON.stringify(field)).not.toContain("360000");
    expect(JSON.stringify(field)).not.toContain("840000");
    expect(JSON.stringify(field)).not.toContain("Glass allowance");
    expect(field?.vendors.every((vendor) => vendor.leveledCents == null && vendor.incomplete === false && vendor.prices.length === 0)).toBe(true);
    expect(bidComposer(actor("dana@rivera.demo"), "proj_okonkwo")?.canEdit).toBe(false);
    expect(() => createBid(actor("dana@rivera.demo"), { projectId: "proj_okonkwo", title: "Nope", dueOn: "2026-10-09", lines: [], vendorContactIds: [] })).toThrow(/office/);
    expect(() => createBid(actor("riley@rivera.demo"), { projectId: "proj_okonkwo", title: "Nope", dueOn: "2026-10-09", lines: [], vendorContactIds: [] })).toThrow(/office/);
    expect(JSON.stringify(portalByToken("demo_portal_okonkwo"))).not.toContain("bid_ok_valve");
    const today = localDay(Date.now(), "America/New_York");
    const later = createBid(actor("maya@rivera.demo"), {
      projectId: "proj_okonkwo",
      title: "Far tile",
      dueOn: addCalendarDays(today, 4),
      lines: [{ costCode: "TILE-SHOWER", description: "Tile", qtyMilli: 1000, unit: "ea" }],
      vendorContactIds: ["c_summit"],
    });
    expect(bidQueues("org_rivera").due.count).toBe(1);
    createBid(actor("maya@rivera.demo"), {
      projectId: "proj_okonkwo",
      title: "Soon tile",
      dueOn: addCalendarDays(today, 3),
      lines: [{ costCode: "TILE-SHOWER", description: "Tile", qtyMilli: 1000, unit: "ea" }],
      vendorContactIds: ["c_summit"],
    });
    expect(bidQueues("org_rivera").due.count).toBe(2);
    closeBid(actor("maya@rivera.demo"), later.id);
    expect(bidComparison(actor("maya@rivera.demo"), later.id)?.statusLabel).toBe("Closed");
  });

  it("plugs a missing line for leveling and never writes the vendor price", () => {
    const maya = actor("maya@rivera.demo");
    const today = localDay(Date.now(), "America/New_York");
    const created = createBid(maya, {
      projectId: "proj_okonkwo",
      title: "Level me",
      dueOn: addCalendarDays(today, 2),
      lines: [
        { costCode: "PLB-SHOWER", description: "Valve", qtyMilli: 1000, unit: "ea" },
        { costCode: "BATH-GLASS", description: "Glass", qtyMilli: 1000, unit: "ea" },
      ],
      vendorContactIds: ["c_harbor", "c_casa"],
    });
    const lines = getDb().select().from(bidLines).where(and(eq(bidLines.bidId, created.id), eq(bidLines.orgId, "org_rivera"))).all();
    const plumb = lines.find((row) => row.costCode === "PLB-SHOWER");
    const glass = lines.find((row) => row.costCode === "BATH-GLASS");
    if (!plumb || !glass) throw new Error("missing lines");
    submitVendorBid({
      token: DEMO_HARBOR_PORTAL_TOKEN,
      ip: "198.51.100.86",
      bidId: created.id,
      name: "Pete Alvarez",
      prices: [
        { bidLineId: plumb.id, unitPriceCents: 10_000, noBid: false },
        { bidLineId: glass.id, unitPriceCents: null, noBid: true },
      ],
    });
    const invites = getDb().select().from(bidInvites).where(and(eq(bidInvites.bidId, created.id), eq(bidInvites.orgId, "org_rivera"))).all();
    const harbor = invites.find((row) => row.contactId === "c_harbor");
    const casa = invites.find((row) => row.contactId === "c_casa");
    if (!harbor || !casa) throw new Error("missing invites");
    const plug = { bidId: created.id, inviteId: harbor.id, bidLineId: glass.id, amountCents: 2_500, note: "Plug glass", leftOpen: false };
    expect(() => saveBidPlug(actor("dana@rivera.demo"), plug)).toThrow(/office/);
    expect(() => saveBidPlug(actor("riley@rivera.demo"), plug)).toThrow(/office/);
    expect(() => saveBidPlug(maya, { ...plug, bidLineId: plumb.id })).toThrow(/price/);
    expect(() => saveBidPlug(maya, { ...plug, note: "x".repeat(81) })).toThrow(/shorter/);
    saveBidPlug(maya, plug);
    expect(getDb().select().from(bidPrices).where(and(eq(bidPrices.inviteId, harbor.id), eq(bidPrices.bidLineId, glass.id))).get()).toMatchObject({
      noBid: 1,
      unitPriceCents: null,
    });
    const board = bidComparison(maya, created.id);
    expect(board?.vendors.find((row) => row.name === "Harbor Plumbing")).toMatchObject({ totalCents: 10_000, leveledCents: 12_500, incomplete: false });
    expect(board?.vendors.find((row) => row.name === "Casa Tile")?.incomplete).toBe(true);
    saveBidPlug(actor("luis@rivera.demo"), { ...plug, amountCents: 3_000 });
    expect(bidComparison(maya, created.id)?.vendors.find((row) => row.name === "Harbor Plumbing")?.leveledCents).toBe(13_000);
    saveBidPlug(maya, { bidId: created.id, inviteId: casa.id, bidLineId: plumb.id, amountCents: null, note: "", leftOpen: true });
    saveBidPlug(maya, { bidId: created.id, inviteId: casa.id, bidLineId: glass.id, amountCents: null, note: "", leftOpen: true });
    const casaCol = bidComparison(maya, created.id)?.vendors.find((row) => row.name === "Casa Tile");
    expect(casaCol?.incomplete).toBe(false);
    expect(casaCol?.leveledCents).toBeNull();
    const card = vendorBidPortal(DEMO_HARBOR_PORTAL_TOKEN)?.find((row) => row.id === created.id);
    expect(card?.lines.find((row) => row.id === glass.id)).toMatchObject({ noBid: true, unitPriceCents: null });
    const portalJson = JSON.stringify(card);
    expect(portalJson).not.toContain("3000");
    expect(portalJson).not.toContain("Plug glass");
    expect(portalJson).not.toContain("plugCents");
    expect(JSON.stringify(bidComparison(actor("dana@rivera.demo"), created.id))).not.toContain("3000");
    expect(() =>
      awardBid(maya, {
        bidId: created.id,
        assignments: [
          { bidLineId: plumb.id, contactId: "c_harbor" },
          { bidLineId: glass.id, contactId: "c_harbor" },
        ],
        createPurchaseOrders: false,
        updateBudget: false,
      }),
    ).toThrow(/BATH-GLASS has no price/);
    saveBidPlug(maya, { ...plug, amountCents: null, leftOpen: false });
    expect(bidComparison(maya, created.id)?.vendors.find((row) => row.name === "Harbor Plumbing")?.incomplete).toBe(true);
    saveBidLines(maya, created.id, [
      { costCode: "PLB-SHOWER", description: "Valve", qtyMilli: 1000, unit: "ea" },
      { costCode: "BATH-GLASS", description: "Glass", qtyMilli: 1000, unit: "ea" },
    ]);
    expect(getDb().select().from(bidPlugs).where(and(eq(bidPlugs.orgId, "org_rivera"), eq(bidPlugs.bidId, created.id))).all()).toEqual([]);
    closeBid(maya, created.id);
    expect(() => saveBidPlug(maya, plug)).toThrow(/not out/);
  });

  it("resets prices after a line edit, groups an award into draft purchase orders, and blocks a noncompliant vendor", () => {
    const maya = actor("maya@rivera.demo");
    const today = localDay(Date.now(), "America/New_York");
    const created = createBid(maya, {
      projectId: "proj_okonkwo",
      title: "Reset me",
      dueOn: today,
      lines: [{ budgetLineId: "bud_proj_okonkwo_3", costCode: "", description: "", qtyMilli: 1000, unit: "ea" }],
      vendorContactIds: ["c_harbor"],
    });
    submitVendorBid({
      token: DEMO_HARBOR_PORTAL_TOKEN,
      ip,
      bidId: created.id,
      name: "Pete Alvarez",
      prices: [{ bidLineId: lineId(created.id), unitPriceCents: 12_500, noBid: false }],
    });
    const edited = saveBidLines(maya, created.id, [{ budgetLineId: "bud_proj_okonkwo_3", costCode: "PLB-SHOWER", description: "Valve and trim", qtyMilli: 2000, unit: "ea" }]);
    expect(edited.warning).toMatch(/bid again/);
    const invite = getDb().select().from(bidInvites).where(and(eq(bidInvites.bidId, created.id), eq(bidInvites.orgId, "org_rivera"))).get();
    expect(invite?.status).toBe("needs_revision");
    expect(getDb().select().from(bidPrices).where(eq(bidPrices.inviteId, invite!.id)).all()).toEqual([]);
    submitVendorBid({
      token: DEMO_HARBOR_PORTAL_TOKEN,
      ip,
      bidId: created.id,
      name: "Pete Alvarez",
      prices: [{ bidLineId: lineId(created.id), unitPriceCents: 10_000, noBid: false }],
    });
    getDb().update(bidRequests).set({ dueOn: addCalendarDays(today, -1) }).where(eq(bidRequests.id, created.id)).run();
    expect(() =>
      submitVendorBid({
        token: DEMO_HARBOR_PORTAL_TOKEN,
        ip,
        bidId: created.id,
        name: "Pete Alvarez",
        prices: [{ bidLineId: lineId(created.id), unitPriceCents: 10_000, noBid: false }],
      }),
    ).toThrow(/closed/);
    expect(() => submitVendorBid({ token: DEMO_HARBOR_PORTAL_TOKEN, ip, bidId: "bid_missing", name: "Pete Alvarez", prices: [] })).toThrow(/not found/);

    setVendorCompliance(maya, "block", ["general_liability", "workers_comp"]);
    expect(() =>
      awardBid(maya, {
        bidId: "bid_ok_valve",
        assignments: [
          { bidLineId: "bln_ok_plb", contactId: "c_harbor" },
          { bidLineId: "bln_ok_glass", contactId: "c_casa" },
        ],
        createPurchaseOrders: true,
        updateBudget: true,
      }),
    ).toThrow(/Workers comp missing/);
    expect(getDb().select().from(purchaseOrders).where(eq(purchaseOrders.number, "PO-1057")).get()).toBeUndefined();
    setVendorCompliance(maya, "warn", ["general_liability", "workers_comp"]);
    expect(() =>
      awardBid(maya, {
        bidId: "bid_ok_valve",
        assignments: [
          { bidLineId: "bln_ok_plb", contactId: "c_harbor" },
          { bidLineId: "bln_ok_glass", contactId: "c_harbor" },
        ],
        createPurchaseOrders: false,
        updateBudget: false,
      }),
    ).toThrow(/BATH-GLASS has no price/);
    const awarded = awardBid(maya, {
      bidId: "bid_ok_valve",
      assignments: [
        { bidLineId: "bln_ok_plb", contactId: "c_harbor" },
        { bidLineId: "bln_ok_glass", contactId: "c_casa" },
      ],
      createPurchaseOrders: true,
      updateBudget: true,
    });
    expect(awarded.purchaseOrders).toEqual(["PO-1057", "PO-1058"]);
    expect(awarded.warning).toMatch(/Workers comp missing/);
    const pos = getDb()
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orgId, "org_rivera"))
      .all()
      .filter((row) => awarded.purchaseOrders.includes(row.number));
    expect(pos.every((row) => row.status === "draft")).toBe(true);
    const harborPo = pos.find((row) => row.vendorContactId === "c_harbor");
    const casaPo = pos.find((row) => row.vendorContactId === "c_casa");
    expect(getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, harborPo!.id)).all()).toMatchObject([{ costCode: "PLB-SHOWER", amountCents: 480_000 }]);
    expect(getDb().select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, casaPo!.id)).all()).toMatchObject([{ costCode: "BATH-GLASS", amountCents: 290_000 }]);
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_okonkwo_3")).get()?.budgetCostCents).toBe(480_000);
    expect(getDb().select().from(budgetLines).where(eq(budgetLines.id, "bud_proj_okonkwo_4")).get()?.budgetCostCents).toBe(290_000);
    expect(getDb().select().from(bidInvites).where(eq(bidInvites.id, "binv_brighton")).get()?.status).toBe("lost");
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "bid.award"), eq(auditLogs.entityId, "bid_ok_valve"))).get()?.actorId).toBe("user_maya");
    expect(getDb().select().from(bidPlugs).where(and(eq(bidPlugs.orgId, "org_rivera"), eq(bidPlugs.bidId, "bid_ok_valve"))).all()).toEqual([]);
    expect(bidComparison(maya, "bid_ok_valve")?.vendors.find((row) => row.name === "Harbor Plumbing")).toMatchObject({
      totalCents: 480_000,
      leveledCents: 480_000,
      incomplete: false,
    });
    expect(bidComparison(maya, "bid_ok_valve")?.statusLabel).toBe("Awarded");
    expect(vendorBidPortal(DEMO_HARBOR_PORTAL_TOKEN)?.find((row) => row.id === "bid_ok_valve")?.editable).toBe(false);
    expect(JSON.stringify(bidComparison(actor("dana@rivera.demo"), "bid_ok_valve"))).not.toContain("PO-1057");
  });

  it("rate limits portal bid writes", () => {
    const maya = actor("maya@rivera.demo");
    const today = localDay(Date.now(), "America/New_York");
    const created = createBid(maya, {
      projectId: "proj_okonkwo",
      title: "Limit me",
      dueOn: addCalendarDays(today, 1),
      lines: [{ costCode: "TILE-SHOWER", description: "Tile", qtyMilli: 1000, unit: "ea" }],
      vendorContactIds: ["c_harbor"],
    });
    const limited = "203.0.113.81";
    for (let n = 0; n < 8; n += 1) {
      submitVendorBid({
        token: DEMO_HARBOR_PORTAL_TOKEN,
        ip: limited,
        bidId: created.id,
        name: "Pete Alvarez",
        prices: [{ bidLineId: lineId(created.id), unitPriceCents: 1000 + n, noBid: false }],
      });
    }
    expect(() =>
      submitVendorBid({
        token: DEMO_HARBOR_PORTAL_TOKEN,
        ip: limited,
        bidId: created.id,
        name: "Pete Alvarez",
        prices: [{ bidLineId: lineId(created.id), unitPriceCents: 2000, noBid: false }],
      }),
    ).toThrow(/Too many/);
    expect(() => declineVendorBid({ token: DEMO_HARBOR_PORTAL_TOKEN, ip: limited, bidId: created.id, reason: "Busy" })).toThrow(/Too many/);
  });
});
