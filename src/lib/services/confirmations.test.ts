import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, notifications, scheduleConfirmations, scheduleItems } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { ServiceError } from "@/lib/services/errors";
import {
  confirmSettings,
  itemConfirmations,
  listConfirmations,
  requestConfirmation,
  requestUpcoming,
  resetConfirmedOnHold,
  saveConfirmSettings,
  unconfirmedSoon,
} from "@/lib/services/confirmations";
import { previewScheduleShift, shiftScheduleDates } from "@/lib/services/schedule-shift";
import { rotateVendorPortal, vendorConfirmSchedule, vendorPortal } from "@/lib/services/vendor-portal";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import { emitAutomation, saveAutomation, scanAutomationClock } from "@/lib/services/automations";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("schedule confirmations", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("scopes vendors, refuses another company, and keeps the look-ahead to their items", () => {
    const maya = actor("maya@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    expect(() => requestConfirmation(actor("dana@rivera.demo"), "sch_ok_plumb")).toThrow(/view the schedule/);
    expect(() => requestConfirmation(jordan, "sch_ok_plumb")).toThrow(ServiceError);
    expect(itemConfirmations(jordan, "sch_ok_plumb")).toBeNull();
    const home = vendorPortal(DEMO_HARBOR_PORTAL_TOKEN);
    expect(home?.schedule.map((row) => row.title)).toEqual(expect.arrayContaining(["Set the valve", "Trim out", "Rough-in"]));
    expect(home?.schedule.every((row) => row.job === "Okonkwo primary bath" || row.job === "Brooks family room addition")).toBe(true);
    expect(JSON.stringify(home?.schedule)).not.toContain("Homeowner home after 3");
    expect(JSON.stringify(home?.schedule)).not.toContain("amountCents");
    const north = rotateVendorPortal(jordan, "c_north_supply");
    expect(vendorPortal(north)?.schedule.some((row) => row.title === "Set the valve")).toBe(false);
    expect(() => vendorConfirmSchedule(north, "sch_ok_plumb", { decision: "confirm" }, "203.0.113.8")).toThrow(/Not found/);
    expect(listConfirmations(maya).rows.some((row) => row.title === "Trim out" && row.pill === "Declined")).toBe(true);
    expect(unconfirmedSoon("org_rivera").count).toBeGreaterThan(0);
    expect(confirmSettings(maya).autoRequest).toBe(false);
  });

  it("confirms, declines, resets on a date move and a hold, and lists the cascade", () => {
    const maya = actor("maya@rivera.demo");
    const asked = requestConfirmation(maya, "sch_ok_rough");
    expect(asked.message).toContain("Rough-in");
    expect(asked.url).toContain("/v/");
    vendorConfirmSchedule(DEMO_HARBOR_PORTAL_TOKEN, "sch_ok_rough", { decision: "confirm" }, "203.0.113.9");
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_rough")).get()?.confirmStatus).toBe("confirmed");
    const row = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_rough")).get()!;
    const preview = previewScheduleShift(maya, "sch_ok_rough", "2026-11-02", "2026-11-03");
    expect(preview.resets.map((item) => item.title)).toContain("Rough-in");
    expect(preview.label).toContain("Resets Rough-in");
    shiftScheduleDates(maya, "sch_ok_rough", "2026-11-02", "2026-11-03");
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_rough")).get()?.confirmStatus).toBe("requested");
    expect(getDb().select().from(scheduleConfirmations).where(eq(scheduleConfirmations.itemId, "sch_ok_rough")).all().some((event) => event.event === "reset")).toBe(true);
    vendorConfirmSchedule(DEMO_HARBOR_PORTAL_TOKEN, "sch_ok_rough", { decision: "decline", reason: "Crew is on another job", proposedDate: "2026-11-06" }, "203.0.113.10");
    const declined = itemConfirmations(maya, "sch_ok_rough");
    expect(declined?.status).toBe("declined");
    expect(declined?.reason).toBe("Crew is on another job");
    expect(declined?.proposed).toBe("2026-11-06");
    expect(getDb().select().from(notifications).where(eq(notifications.kind, "confirmation")).all().some((note) => note.snippet.includes("Rough-in"))).toBe(true);
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "confirmation.decline" && row.entityId === "sch_ok_rough")).toBe(true);
    vendorConfirmSchedule(DEMO_HARBOR_PORTAL_TOKEN, "sch_ok_plumb", { decision: "confirm" }, "203.0.113.11");
    const cascade = previewScheduleShift(maya, "sch_ok_demo", "2026-11-02", "2026-11-03");
    expect(cascade.resets.map((item) => item.id)).toContain("sch_ok_plumb");
    resetConfirmedOnHold("org_rivera", ["sch_ok_plumb"]);
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_plumb")).get()?.confirmStatus).toBe("requested");
    expect(row.startDate).not.toBe("2026-11-02");
    const upcoming = requestUpcoming(maya, "c_harbor", 2);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(() => vendorConfirmSchedule(DEMO_HARBOR_PORTAL_TOKEN, "sch_ok_tile", { decision: "confirm" }, "203.0.113.12")).toThrow(/Not found/);
  });

  it("requests from the declined automation and the unconfirmed scan", () => {
    const maya = actor("maya@rivera.demo");
    saveConfirmSettings(maya, { autoRequest: false, remindDays: 3 });
    saveAutomation(maya, {
      name: "Ask again",
      enabled: true,
      trigger: { kind: "schedule_declined" },
      conditions: [],
      actions: [{ kind: "request_confirmation" }],
    });
    emitAutomation({
      orgId: "org_rivera",
      kind: "schedule_declined",
      recordType: "schedule_item",
      recordId: "sch_ok_trim",
      recordLabel: "Trim out",
      projectId: "proj_okonkwo",
      name: "Trim out",
      scheduleItemId: "sch_ok_trim",
    });
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_trim")).get()?.confirmStatus).toBe("requested");
    saveAutomation(maya, {
      name: "Soon",
      enabled: true,
      trigger: { kind: "unconfirmed_before", days: 3 },
      conditions: [],
      actions: [{ kind: "request_confirmation" }],
    });
    expect(scanAutomationClock("org_rivera").ran).toBeGreaterThan(0);
  });
});
