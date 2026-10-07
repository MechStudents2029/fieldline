import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, changeOrders, scheduleItems } from "@/lib/db/schema";
import { IP_LIMIT } from "@/lib/lead-form/rules";
import { authenticate } from "@/lib/services/read";
import { scheduleBoard, saveScheduleItem } from "@/lib/services/schedule";
import {
  answerClientRfi,
  answerVendorRfi,
  clientPortalRfis,
  closeRfi,
  createRfi,
  draftChangeFromRfi,
  jobRfis,
  rfiDetail,
  rfiQueue,
  shiftRfiSchedule,
  vendorPortalRfis,
  voidRfi,
} from "@/lib/services/rfis";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const openRfi = {
  title: "Hold point",
  question: "Can we set this tomorrow?",
  dueOn: "2026-12-01",
  assignee: "user:user_dana",
  related: null,
  internalNote: null,
};

describe("RFIs", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps RFI rows on the member policy and out of the money policy", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in array array["), sql.lastIndexOf("foreach tbl in array array["));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in array array["));
    for (const table of ["rfis", "rfi_messages", "rfi_files", "rfi_attempts"]) {
      expect(member).toContain(`'${table}'`);
      expect(money).not.toContain(`'${table}'`);
    }
  });

  it("scopes seed RFIs by company, vendor, client, and field", () => {
    const maya = actor("maya@rivera.demo");
    const board = jobRfis(maya, "proj_okonkwo");
    expect(board?.items.map((item) => item.label)).toEqual(["RFI-001", "RFI-002", "RFI-003"]);
    expect(board?.items.find((item) => item.title === "Valve height")?.overdue).toBe(true);
    expect(rfiQueue(maya)).toMatchObject({ overdue: { count: 1 }, awaiting: { count: 0 } });
    expect(jobRfis(actor("jordan@northline.demo"), "proj_okonkwo")).toBeNull();
    const field = JSON.stringify({ board: jobRfis(actor("dana@rivera.demo"), "proj_okonkwo"), detail: rfiDetail(actor("dana@rivera.demo"), "rfi_ok_niche") });
    expect(field).not.toContain("180000");
    expect(field).not.toContain("Do not share the allowance");
    const vendor = vendorPortalRfis(DEMO_HARBOR_PORTAL_TOKEN);
    expect(vendor.map((item) => item.title)).toEqual(["Valve height"]);
    expect(JSON.stringify(vendor)).not.toContain("Vanity quartz");
    expect(JSON.stringify(vendor)).not.toContain("allowance");
    expect(JSON.stringify(vendor)).not.toContain("180000");
    const client = clientPortalRfis("demo_portal_okonkwo");
    expect(client.map((item) => item.title)).toEqual(["Vanity quartz"]);
    expect(JSON.stringify(client)).not.toContain("Valve height");
    expect(JSON.stringify(client)).not.toContain("allowance");
    expect(JSON.stringify(client)).not.toContain("180000");
    expect(clientPortalRfis("demo_portal_brooks")).toEqual([]);
    expect(() => answerClientRfi({ token: "demo_portal_okonkwo", rfiId: "rfi_ok_valve", body: "No", ip: "198.51.100.8" })).toThrow(/not found/i);
    const chips = scheduleBoard(maya, {}).rows.flatMap((row) => row.cells.flatMap((cell) => cell.items));
    expect(chips.some((chip) => chip.title === "Set the valve" && chip.rfiDue)).toBe(true);
  });

  it("blocks a viewer and numbers the next RFI past a void", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => createRfi(actor("riley@rivera.demo"), "proj_chen", openRfi)).toThrow(/cannot change/i);
    expect(() => closeRfi(actor("dana@rivera.demo"), "rfi_ok_valve", { costImpact: true, costImpactCents: 100 })).toThrow(/cannot change/i);
    const first = createRfi(maya, "proj_chen", openRfi);
    const second = createRfi(maya, "proj_chen", { ...openRfi, title: "Second hold" });
    voidRfi(maya, first);
    const third = createRfi(maya, "proj_chen", { ...openRfi, title: "Third hold" });
    const labels = jobRfis(maya, "proj_chen")?.items ?? [];
    expect(labels.map((item) => item.label)).toEqual(["RFI-001", "RFI-002", "RFI-003"]);
    expect(labels.find((item) => item.id === first)?.status).toBe("void");
    expect(labels.find((item) => item.id === second)?.status).toBe("open");
    expect(labels.find((item) => item.id === third)?.number).toBe(3);
    expect(jobRfis(actor("jordan@northline.demo"), "proj_chen")).toBeNull();
  });

  it("turns a cost impact into one draft change order", () => {
    const maya = actor("maya@rivera.demo");
    const rfiId = createRfi(maya, "proj_okonkwo", { ...openRfi, title: "Blocking price", assignee: "user:user_maya" });
    closeRfi(maya, rfiId, { costImpact: true, costImpactCents: 25_000, scheduleImpactDays: null });
    const changeOrderId = draftChangeFromRfi(maya, rfiId);
    const order = getDb().select().from(changeOrders).where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, "org_rivera"))).get();
    expect(order?.status).toBe("draft");
    expect(order?.priceDeltaCents).toBe(25_000);
    expect(rfiDetail(maya, rfiId)?.changeOrderId).toBe(changeOrderId);
    expect(() => draftChangeFromRfi(maya, rfiId)).toThrow(/already linked/i);
    const audits = getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, "org_rivera"), eq(auditLogs.entityId, rfiId))).all();
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["rfi.create", "rfi.close", "rfi.impact"]));
  });

  it("shifts the linked schedule item and keeps its length", () => {
    const maya = actor("maya@rivera.demo");
    const itemId = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Hold the wall",
      startDate: "2026-11-02",
      endDate: "2026-11-04",
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: [],
    });
    const rfiId = createRfi(maya, "proj_chen", { ...openRfi, title: "Wall hold", related: `schedule:${itemId}` });
    closeRfi(maya, rfiId, { costImpact: false, scheduleImpactDays: 2 });
    expect(shiftRfiSchedule(maya, rfiId)).toEqual({ startDate: "2026-11-04", endDate: "2026-11-06" });
    const item = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
    expect(item?.startDate).toBe("2026-11-04");
    expect(item?.endDate).toBe("2026-11-06");
    expect(() => shiftRfiSchedule(maya, rfiId)).toThrow(/already on the schedule/i);
    const audit = getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, rfiId), eq(auditLogs.action, "rfi.impact")))
      .all()
      .map((row) => row.payloadJson ?? "");
    expect(audit.some((payload) => payload.includes("2026-11-02") && payload.includes("2026-11-06"))).toBe(true);
  });

  it("counts overdue RFIs and the ones waiting on you", () => {
    const maya = actor("maya@rivera.demo");
    createRfi(maya, "proj_okonkwo", { ...openRfi, title: "Maya's question", assignee: "user:user_maya", dueOn: "2020-01-01" });
    expect(rfiQueue(maya).awaiting.count).toBe(1);
    expect(rfiQueue(maya).overdue.count).toBe(2);
    expect(rfiQueue(actor("dana@rivera.demo")).awaiting.count).toBe(2);
  });

  it("rate limits portal answers", () => {
    for (let index = 0; index < IP_LIMIT; index += 1) {
      answerVendorRfi({ token: DEMO_HARBOR_PORTAL_TOKEN, rfiId: "rfi_ok_valve", body: `Height is 42 inches (${index}).`, ip: "203.0.113.44" });
    }
    expect(vendorPortalRfis(DEMO_HARBOR_PORTAL_TOKEN).find((item) => item.title === "Valve height")?.status).toBe("answered");
    expect(() => answerVendorRfi({ token: DEMO_HARBOR_PORTAL_TOKEN, rfiId: "rfi_ok_valve", body: "Again", ip: "203.0.113.44" })).toThrow(/Too many requests/);
  });
});
