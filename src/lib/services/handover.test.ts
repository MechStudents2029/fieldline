import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, handoverItems, submittals } from "@/lib/db/schema";
import { nextMaintenance, warrantyEnd } from "@/lib/handover/package";
import { mentionUnread } from "@/lib/services/comments";
import {
  addItem,
  attachDoc,
  handoverAttention,
  handoverDetail,
  listHandovers,
  markReady,
  portalHandover,
  publicHandover,
  publishHandover,
  saveItem,
  startHandover,
} from "@/lib/services/handover";
import { punchBoard, submitWarranty } from "@/lib/services/punch";
import { authenticate } from "@/lib/services/read";
import { ServiceError } from "@/lib/services/errors";
import { localDay } from "@/lib/time/calendar";
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

function counts(board: NonNullable<ReturnType<typeof punchBoard>>) {
  return board.closeout.checklist.map((row) => [row.key, row.count]);
}

describe("homeowner handover", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the new tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["handover_packages", "handover_sections", "handover_items"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
  });

  it("seeds a delivered Diaz package and a Lang draft missing two documents", () => {
    const maya = actor("maya@rivera.demo");
    expect(handoverAttention(maya)).toMatchObject({ count: 1, href: "/handover?filter=due" });
    expect(handoverAttention(maya).note).toContain("HVAC filter");
    expect(listHandovers(maya, { filter: "delivered" }).map((row) => row.job)).toEqual(["Diaz deck replacement"]);
    expect(listHandovers(maya, { filter: "draft" }).map((row) => [row.job, row.readiness])).toEqual([["Lang hall", 2]]);
    expect(listHandovers(maya, { filter: "due" }).map((row) => row.job)).toEqual(["Diaz deck replacement"]);
    const diaz = portalHandover("demo_portal_diaz");
    expect(diaz?.warrantyEndsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const installed = diaz?.sections.find((section) => section.kind === "installed")?.items ?? [];
    expect(installed.length).toBeGreaterThanOrEqual(6);
    expect(installed.length).toBeLessThanOrEqual(10);
    expect(installed.every((item) => item.documentId)).toBe(true);
    expect(installed.filter((item) => item.nextDueOn).map((item) => item.title)).toEqual(["HVAC filter"]);
    expect(installed.some((item) => item.title === "Deck light" && item.warrantyEndsOn)).toBe(true);
    const trades = diaz?.sections.find((section) => section.kind === "trades")?.items ?? [];
    expect(trades.some((item) => item.vendorName === "Summit Lumber" && item.phone === "(510) 555-0301" && item.trade === "DECK-BOARD")).toBe(true);
    expect(portalHandover("demo_portal_lien_ca")).toBeNull();
    expect(portalHandover("demo_portal_okonkwo")).toBeNull();
    expect(portalHandover(DEMO_HARBOR_PORTAL_TOKEN)).toBeNull();
    expect(publicHandover("demo_ho_diaz")?.job).toBe("Diaz deck replacement");
    expect(publicHandover("demo_ho_lang")).toBeNull();
    expect(punchBoard(maya, "proj_lien_ca")?.closeout.checklist.find((row) => row.key === "handover")?.count).toBe(1);
    expect(punchBoard(maya, "proj_diaz")?.closeout.checklist.find((row) => row.key === "handover")?.count).toBe(0);
    expect(punchBoard(maya, "proj_okonkwo")?.closeout.checklist.find((row) => row.key === "handover")?.count).toBe(0);
    expect(mentionUnread(maya)).toBe(2);
  });

  it("refuses field edits and another company", () => {
    expect(() => startHandover(actor("dana@rivera.demo"), "proj_chen")).toThrow(ServiceError);
    expect(() => startHandover(actor("riley@rivera.demo"), "proj_chen")).toThrow(ServiceError);
    expect(() => startHandover(actor("jordan@northline.demo"), "proj_okonkwo")).toThrow(ServiceError);
    expect(handoverDetail(actor("jordan@northline.demo"), "ho_diaz")).toBeNull();
  });

  it("prefills approved rows, gates ready on missing manuals, and publishes only this job", () => {
    const maya = actor("maya@rivera.demo");
    getDb().update(submittals).set({ status: "approved" }).where(eq(submittals.id, "sub_ok_valve")).run();
    const packageId = startHandover(maya, "proj_okonkwo");
    const detail = handoverDetail(maya, packageId);
    const selections = detail?.sections.find((section) => section.kind === "selections")?.items ?? [];
    expect(selections.map((item) => item.title)).toEqual(["Vanity"]);
    expect(selections[0]).toMatchObject({ model: "Quartz vanity", vendorName: "Bathworks" });
    const subs = detail?.sections.find((section) => section.kind === "submittals")?.items ?? [];
    expect(subs.map((item) => item.title)).toEqual(["Shower valve cut sheet"]);
    expect(subs[0]?.documentId).toBe("doc_sub_valve");
    const specs = detail?.sections.find((section) => section.kind === "specs")?.items ?? [];
    expect(specs.map((item) => [item.title, item.documentId])).toEqual([
      ["Shower niche, tiled", "doc_ok_a101_r2"],
      ["Shower tile", null],
    ]);
    expect(detail?.sections.find((section) => section.kind === "files")?.items.map((item) => item.title)).toEqual(["A-101 floor plan"]);
    const trades = detail?.sections.find((section) => section.kind === "trades")?.items ?? [];
    expect(trades.some((item) => item.vendorName === "Harbor Plumbing" && item.phone === "(510) 555-0202" && item.trade === "PLB-SHOWER")).toBe(true);
    expect(detail?.readiness).toBe(0);
    expect(punchBoard(maya, "proj_okonkwo")?.closeout.checklist.find((row) => row.key === "handover")?.count).toBe(1);

    const installedId = detail?.sections.find((section) => section.kind === "installed")?.id ?? "";
    const itemId = addItem(maya, installedId, "E2E valve");
    expect(handoverDetail(maya, packageId)?.readiness).toBe(1);
    expect(() => markReady(maya, packageId)).toThrow(/missing documents/);
    expect(handoverDetail(maya, packageId)?.status).toBe("draft");
    attachDoc(maya, itemId, "doc_ok_a101_r2");
    expect(handoverDetail(maya, packageId)?.readiness).toBe(0);
    const today = localDay(Date.now(), "America/New_York");
    saveItem(maya, itemId, { installOn: "2026-01-31", warrantyMonths: "1", intervalDays: "90", intervalLabel: "Filter" });
    const saved = handoverDetail(maya, packageId)?.sections.find((section) => section.kind === "installed")?.items.find((item) => item.id === itemId);
    expect(saved?.warrantyEndsOn).toBe(warrantyEnd("2026-01-31", 1));
    expect(saved?.nextDueOn).toBe(nextMaintenance("2026-01-31", 90, today));
    markReady(maya, packageId);
    expect(handoverDetail(maya, packageId)?.status).toBe("ready");
    expect(punchBoard(maya, "proj_okonkwo")?.closeout.checklist.find((row) => row.key === "handover")?.count).toBe(0);
    expect(() => publishHandover(actor("dana@rivera.demo"), packageId)).toThrow(ServiceError);
    publishHandover(maya, packageId);
    expect(portalHandover("demo_portal_okonkwo")?.sections.some((section) => section.items.some((item) => item.title === "E2E valve"))).toBe(true);
    expect(portalHandover("demo_portal_chen")).toBeNull();
    expect(counts(punchBoard(maya, "proj_okonkwo")!).some((row) => row[0] === "handover" && row[1] === 0)).toBe(true);
    const created = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, packageId)).all().map((row) => row.action);
    expect(created).toContain("handover.create");
    expect(created).toContain("handover.ready");
    expect(created).toContain("handover.publish");
  });

  it("ties a warranty request to an installed item on the published package", () => {
    const home = portalHandover("demo_portal_diaz");
    const item = home?.sections.find((section) => section.kind === "installed")?.items.find((row) => row.title === "HVAC filter");
    expect(item?.id).toBeTruthy();
    const started = Date.now() - 10_000;
    const created = submitWarranty({
      token: "demo_portal_diaz",
      ip: "203.0.113.77",
      honeypot: "",
      startedAt: String(started),
      title: "E2E loose board",
      description: "The filter housing rattles.",
      urgency: "normal",
      photos: [],
      itemId: item?.id,
      now: Date.now(),
    });
    expect("id" in created).toBe(true);
    expect(punchBoard(actor("maya@rivera.demo"), "proj_diaz")?.warranty.find((row) => row.title === "E2E loose board")?.itemTitle).toBe("HVAC filter");
    const foreign = getDb()
      .select()
      .from(handoverItems)
      .where(eq(handoverItems.packageId, listHandovers(actor("maya@rivera.demo"), { projectId: "proj_okonkwo" })[0]?.id ?? "missing"))
      .all()[0]?.id;
    expect(foreign).toBeTruthy();
    expect(() =>
      submitWarranty({
        token: "demo_portal_diaz",
        ip: "203.0.113.78",
        honeypot: "",
        startedAt: String(started),
        title: "Wrong job",
        description: "",
        urgency: "normal",
        photos: [],
        itemId: foreign,
        now: Date.now(),
      }),
    ).toThrow(/not on this job/);
  });
});
