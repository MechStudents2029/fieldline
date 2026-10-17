import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { changeOrders, messages, notifications, scheduleDelays, scheduleItems } from "@/lib/db/schema";
import { mentionUnread } from "@/lib/services/comments";
import { changeEventDetail, createChangeEvent, listChangeEvents } from "@/lib/services/change-events";
import {
  addDelayLabor,
  applyDelayDays,
  convertDelay,
  createDelay,
  linkDelayItem,
  delayAttention,
  delayDetail,
  delayPackageByToken,
  delaysCsv,
  documentDelay,
  listDelays,
  markDelayShared,
  saveDelay,
  voidDelay,
} from "@/lib/services/delays";
import { ServiceError } from "@/lib/services/errors";
import { authenticate } from "@/lib/services/read";

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

describe("delay claims", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the new tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["delay_claims", "delay_labor", "delay_items", "delay_files"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
  });

  it("seeds one aged open partial and one documented weather day", () => {
    const maya = actor("maya@rivera.demo");
    const attention = delayAttention(maya);
    expect(attention.age).toEqual({ count: 1, href: "/delays?filter=age" });
    expect(attention.weather).toEqual({ count: 1, href: "/delays?filter=weather" });
    expect(listDelays(maya, { filter: "age" }).map((row) => row.title)).toEqual(["Rain on tile"]);
    const open = delayDetail(maya, "dc_ok_rain");
    expect(open).toMatchObject({ status: "open", cause: "weather", impact: "partial", lostHours: "4", scheduleDays: 1 });
    expect(open?.items.map((row) => row.scheduleItemId)).toEqual(["sch_ok_tile"]);
    expect(open?.labor.map((row) => row.costCode)).toEqual(["BATH-GLASS"]);
    const documented = delayDetail(maya, "dc_ok_full");
    expect(documented).toMatchObject({ status: "documented", impact: "full", cause: "weather", changeEventId: null, scheduleDays: 1 });
    expect(documented?.files.map((row) => row.filename)).toEqual(["valve-photo.png"]);
    expect(delayPackageByToken("dc_ok_full_token")).toBeNull();
    expect(delayPackageByToken("dc_ok_rain_token")).toBeNull();
    expect(delayPackageByToken("missing")).toBeNull();
    expect(delayDetail(actor("jordan@northline.demo"), "dc_ok_rain")).toBeNull();
    expect(listChangeEvents(maya, { filter: "open" }).map((row) => row.title)).toEqual(["Valve height gap"]);
    expect(mentionUnread(maya)).toBe(2);
    expect(delaysCsv(maya)).toContain("Rain on tile");
    expect(delaysCsv(maya)).toContain("Site closed for rain");
  });

  it("totals lost hours, documents, converts once, and leaves the schedule", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const beforeOrders = getDb().select().from(changeOrders).all().length;
    const beforeMessages = getDb().select().from(messages).all().length;
    const beforeNotes = getDb().select().from(notifications).all().length;
    const beforeVariance = getDb().select().from(scheduleDelays).all().length;
    const tile = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_tile")).get();
    expect(() => createDelay(riley, "proj_okonkwo", { title: "Nope", cause: "weather", impact: "partial", startedAt: "2026-12-01T08:00", endedAt: "2026-12-01T12:00" })).toThrow(ServiceError);
    const created = createDelay(dana, "proj_okonkwo", {
      title: "E2E rain hold",
      cause: "weather",
      impact: "partial",
      startedAt: "2026-12-01T08:00",
      endedAt: "2026-12-01T12:00",
      weatherNote: "52 F rain",
      idleHoursMilli: 1_000,
      labor: [{ costCode: "BATH-GLASS", hoursMilli: 2_000 }],
    });
    expect(delayDetail(dana, created)?.status).toBe("open");
    expect(delayDetail(dana, created)?.number).toBe(3);
    expect(() => documentDelay(dana, created)).toThrow(/cannot change/);
    expect(() => convertDelay(dana, created)).toThrow(/cannot change/);
    expect(() => voidDelay(dana, created, "No")).toThrow(/cannot change/);
    addDelayLabor(maya, created, { trade: "Tile", hoursMilli: 1_500 });
    expect(delayDetail(maya, created)?.lostHoursMilli).toBe(3_500);
    expect(delayDetail(maya, created)?.lostHours).toBe("3.5");
    saveDelay(maya, created, {
      title: "E2E rain hold",
      cause: "weather",
      impact: "partial",
      startedAt: "2026-12-01T08:00",
      endedAt: "2026-12-01T12:00",
      weatherNote: "52 F rain",
      idleHoursMilli: 1_000,
      scheduleDays: 1,
    });
    expect(() => convertDelay(maya, created)).toThrow(/Document this delay first/);
    documentDelay(luis, created);
    expect(delayDetail(maya, created)?.status).toBe("documented");
    const plumbBefore = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_plumb")).get()?.startDate;
    linkDelayItem(maya, created, "sch_ok_plumb");
    applyDelayDays(maya, created);
    expect(delayDetail(maya, created)?.items.find((row) => row.scheduleItemId === "sch_ok_plumb")?.daysClaimed).toBe(1);
    expect(getDb().select().from(scheduleItems).where(and(eq(scheduleItems.id, "sch_ok_plumb"), eq(scheduleItems.orgId, maya.orgId))).get()?.startDate).toBe(plumbBefore);
    const eventId = convertDelay(maya, created);
    const event = changeEventDetail(maya, eventId);
    expect(event).toMatchObject({ status: "open", scheduleDays: 1, sourceKind: "delay", sourceId: created, reason: "unforeseen" });
    expect(event?.codes.map((row) => row.costCode).sort()).toEqual(["BATH-GLASS", "Tile"]);
    expect(event?.sourceLabel).toBe("Delay 3");
    expect(delayDetail(maya, created)?.status).toBe("converted");
    expect(delayDetail(maya, created)?.changeEventId).toBe(eventId);
    expect(() => convertDelay(maya, created)).toThrow(/Already converted/);
    expect(getDb().select().from(changeOrders).all().length).toBe(beforeOrders);
    expect(getDb().select().from(messages).all().length).toBe(beforeMessages);
    expect(getDb().select().from(notifications).all().length).toBe(beforeNotes);
    expect(getDb().select().from(scheduleDelays).all().length).toBe(beforeVariance);
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_tile")).get()?.startDate).toBe(tile?.startDate);
    expect(() =>
      createChangeEvent(maya, "proj_chen", { title: "Wrong job", reason: "field", costCode: "TILE-FLR", sourceKind: "delay", sourceId: created }),
    ).toThrow(/not on this job/);
    expect(() => voidDelay(luis, "dc_ok_rain", "Office")).toThrow(/cannot change/);
    expect(() => voidDelay(maya, "dc_ok_rain", "  ")).toThrow(/Add a reason/);
    voidDelay(maya, "dc_ok_rain", "Recorded in error");
    expect(delayDetail(maya, "dc_ok_rain")?.status).toBe("voided");
    expect(delayDetail(maya, "dc_ok_rain")?.voidReason).toBe("Recorded in error");
    expect(() => voidDelay(maya, "dc_ok_rain", "Again")).toThrow(/locked/);
    markDelayShared(maya, "dc_ok_full");
    const pack = delayPackageByToken("dc_ok_full_token");
    expect(pack?.title).toBe("Site closed for rain");
    expect(pack?.lostHours).toBe("8");
    expect(pack?.weatherNote).toBe("41 F heavy rain");
    expect(pack?.photos.map((row) => row.filename)).toEqual(["valve-photo.png"]);
    expect(delaysCsv(maya, { cause: "weather", impact: "full", projectId: "proj_okonkwo" })).toContain("Site closed for rain");
  });
});
