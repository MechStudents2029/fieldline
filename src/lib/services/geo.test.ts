import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { notifications, projects, timeEntries, timeEntryEvents, timeGeoOverrides } from "@/lib/db/schema";
import { listInbox } from "@/lib/services/comments";
import {
  adoptSitePin,
  geoBoard,
  overrideSite,
  saveGeoSettings,
  setSitePin,
  siteAttention,
  sitePinView,
} from "@/lib/services/geo";
import { authenticate } from "@/lib/services/read";
import { applyOfflineBatch } from "@/lib/services/sync";
import { addNonJobShift } from "@/lib/time/post";
import { approvedHoursCsv, approveTime, clockIn, clockOut, switchJob, timeBoard, timeReview } from "@/lib/services/time";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

function entry(id: string) {
  const row = getDb().select().from(timeEntries).where(eq(timeEntries.id, id)).get();
  if (!row) throw new Error(`missing ${id}`);
  return row;
}

describe("job-site geofence", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds pins, an outside punch, and an audited override", () => {
    const okonkwo = getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get();
    expect(okonkwo?.siteLatE6).toBe(37_799_400);
    expect(okonkwo?.siteLngE6).toBe(-122_247_000);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_diaz")).get()?.siteLatE6).toBeNull();
    expect(entry("time_ok_tile").geoInVerdict).toBe("inside");
    expect(entry("time_dana_gap_a").geoInVerdict).toBe("outside");
    expect(entry("time_ok_overlap").geoInVerdict).toBe("missing");
    expect(entry("time_sam_pto").geoInVerdict).toBeNull();
    const reasons = getDb().select().from(timeGeoOverrides).where(eq(timeGeoOverrides.entryId, "time_ok_overlap")).all();
    expect(reasons.map((row) => row.reason).sort()).toEqual(["Supplier run", "Supplier run confirmed"]);
    const review = timeReview(actor("maya@rivera.demo"));
    const curb = review.entries.find((row) => row.id === "time_dana_gap_a");
    expect(curb?.site).toBe("Outside 0.4 mi");
    expect(curb?.siteLine).toContain("37.80518");
    const supplier = review.entries.find((row) => row.id === "time_ok_overlap");
    expect(supplier?.site).toBe("No location");
    expect(supplier?.siteOverridden).toBe(true);
    expect(supplier?.siteReason).toBe("Supplier run confirmed");
    expect(review.rows.some((row) => row.hours.some((cell) => cell.site === "Outside 0.4 mi"))).toBe(true);
    expect(siteAttention(actor("maya@rivera.demo")).count).toBe(1);
    expect(siteAttention(actor("dana@rivera.demo")).count).toBe(0);
    expect(siteAttention(actor("luis@rivera.demo")).href).toBe("/time");
    expect(listInbox(actor("maya@rivera.demo"), "all").some((row) => row.kind === "site" && row.snippet.includes("Outside"))).toBe(true);
    expect(listInbox(actor("dana@rivera.demo"), "all").some((row) => row.kind === "site")).toBe(false);
    const field = JSON.stringify(timeBoard(actor("dana@rivera.demo")));
    expect(field).toContain("Outside 0.4 mi");
    expect(field).not.toContain("37.80518");
    expect(field).not.toContain("5200");
    expect(readFileSync(path.join(process.cwd(), "supabase", "rls.sql"), "utf8")).toContain("time_geo_overrides_scope");
  });

  it("saves an outside punch, warns on approve, and keeps a new override", () => {
    const maya = actor("maya@rivera.demo");
    const start = Date.now() - 3 * 60 * 60 * 1000;
    const opened = clockIn(maya, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER", lat: "37.80518", lng: "-122.247", accuracy: "8" }, start);
    expect(entry(opened.entryId).geoInVerdict).toBe("outside");
    expect(entry(opened.entryId).status).toBe("open");
    clockOut(maya, { lat: "37.80518", lng: "-122.247", accuracy: "8" }, start + 60 * 60 * 1000);
    const closed = entry(opened.entryId);
    expect(closed.status).toBe("pending");
    expect(closed.geoOutVerdict).toBe("outside");
    expect(getDb().select().from(notifications).where(and(eq(notifications.kind, "site"), eq(notifications.entityId, opened.entryId))).all().length).toBeGreaterThan(0);
    const warned = approveTime(maya, opened.entryId, start + 60 * 60 * 1000);
    expect(warned.siteWarning).toMatch(/site flag/);
    expect(entry(opened.entryId).status).toBe("approved");
    expect(() => overrideSite(actor("dana@rivera.demo"), opened.entryId, "Crew was at the yard")).toThrow(/office/);
    overrideSite(maya, opened.entryId, "Crew was at the yard");
    overrideSite(maya, opened.entryId, "Yard run stands");
    const rows = getDb().select().from(timeGeoOverrides).where(eq(timeGeoOverrides.entryId, opened.entryId)).all();
    expect(rows).toHaveLength(2);
    expect(timeReview(maya).entries.find((row) => row.id === opened.entryId)?.siteReason).toBe("Yard run stands");
    expect(getDb().select().from(timeEntryEvents).where(and(eq(timeEntryEvents.entryId, opened.entryId), eq(timeEntryEvents.type, "site_override"))).all()).toHaveLength(2);
    const day = closed.clockInAt.slice(0, 10);
    const csv = approvedHoursCsv(maya, "2020-01-01", "2030-01-01", "outside");
    expect(csv.split("\n")[0]).toContain(",site");
    expect(csv).toContain("Outside");
    expect(csv).not.toContain("Set the shower wall");
    expect(approvedHoursCsv(maya, day, day).split("\n")[0]?.endsWith(",site")).toBe(true);
  });

  it("requires an override before approval, and a per-person toggle is stricter than warn", () => {
    const maya = actor("maya@rivera.demo");
    saveGeoSettings(maya, { mode: "require", radius: 984, unit: "ft", requireUserIds: [] });
    const start = Date.now() - 5 * 60 * 60 * 1000;
    const opened = clockIn(maya, { projectId: "proj_chen", costCode: "GC-SUPER", lat: "37.81", lng: "-122.247", accuracy: "5" }, start);
    clockOut(maya, { lat: "37.81", lng: "-122.247", accuracy: "5" }, start + 30 * 60 * 1000);
    expect(entry(opened.entryId).geoInVerdict).toBe("outside");
    expect(() => approveTime(maya, opened.entryId, start + 30 * 60 * 1000)).toThrow(/Override the site flag/);
    expect(entry(opened.entryId).status).toBe("pending");
    overrideSite(maya, opened.entryId, "Client meeting off site");
    expect(approveTime(maya, opened.entryId, start + 30 * 60 * 1000).siteWarning).toBeNull();

    saveGeoSettings(maya, { mode: "warn", radius: 984, unit: "ft", requireUserIds: ["user_sam"] });
    const samStart = Date.now() - 4 * 60 * 60 * 1000;
    const sam = actor("sam@rivera.demo");
    const samOpen = clockIn(sam, { projectId: "proj_chen", costCode: "GC-SUPER" }, samStart);
    expect(entry(samOpen.entryId).geoInVerdict).toBe("missing");
    clockOut(sam, {}, samStart + 45 * 60 * 1000);
    expect(() => approveTime(maya, samOpen.entryId, samStart + 45 * 60 * 1000)).toThrow(/Override the site flag/);
    saveGeoSettings(maya, { mode: "off", radius: 984, unit: "ft", requireUserIds: [] });
    const off = clockIn(maya, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER", lat: "37.81", lng: "-122.247" }, Date.now() - 2 * 60 * 60 * 1000);
    expect(entry(off.entryId).geoInVerdict).toBe("off");
    clockOut(maya, { lat: "37.81", lng: "-122.247" }, Date.now() - 90 * 60 * 1000);
    expect(approveTime(maya, off.entryId).siteWarning).toBeNull();
    saveGeoSettings(maya, { mode: "warn", radius: 984, unit: "ft", requireUserIds: [] });
  });

  it("marks weak GPS, a job with no pin, and general time without a false outside", () => {
    const maya = actor("maya@rivera.demo");
    const weak = clockIn(maya, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER", lat: "37.81", lng: "-122.247", accuracy: "2000" }, Date.now() - 50 * 60 * 1000);
    expect(entry(weak.entryId).geoInVerdict).toBe("weak");
    clockOut(maya, { accuracy: "2000", lat: "37.7994", lng: "-122.247" }, Date.now() - 40 * 60 * 1000);
    const bare = clockIn(maya, { projectId: "proj_diaz", costCode: "GC-SUPER", lat: "37.81", lng: "-122.247" }, Date.now() - 35 * 60 * 1000);
    expect(entry(bare.entryId).geoInVerdict).toBe("no_pin");
    expect(entry(bare.entryId).geoInVerdict).not.toBe("outside");
    clockOut(maya, {}, Date.now() - 30 * 60 * 1000);
    const pto = addNonJobShift(maya, { userId: "user_maya", day: "2026-04-02", hours: 8, shiftType: "pto" });
    expect(entry(pto.entryId).geoInVerdict).toBeNull();
    expect(entry(pto.entryId).geoOutVerdict).toBeNull();
  });

  it("evaluates a switch and an offline sync when the punch lands", () => {
    const maya = actor("maya@rivera.demo");
    const start = Date.now() - 25 * 60 * 1000;
    const opened = clockIn(maya, { projectId: "proj_okonkwo", costCode: "TILE-SHOWER", lat: "37.7994", lng: "-122.247", accuracy: "6" }, start);
    const next = switchJob(maya, { projectId: "proj_chen", costCode: "GC-SUPER", lat: "37.7994", lng: "-122.247", accuracy: "6" }, start + 5 * 60 * 1000);
    expect(entry(opened.entryId).geoOutVerdict).toBe("inside");
    expect(entry(next.entryId).geoInVerdict).toBe("outside");
    expect(entry(next.entryId).clockInLatE6).toBe(37_799_400);
    clockOut(maya, { lat: "37.7994", lng: "-122.247" }, start + 10 * 60 * 1000);

    const captured = new Date(Date.now() - 20_000).toISOString();
    const outAt = new Date(Date.now() - 10_000).toISOString();
    const results = applyOfflineBatch(
      maya,
      [
        {
          clientEventId: randomUUID(),
          seq: 1,
          kind: "clock_in",
          capturedAt: captured,
          orgId: maya.orgId,
          userId: maya.userId,
          projectId: "proj_okonkwo",
          costCode: "TILE-SHOWER",
          lat: "37.82",
          lng: "-122.247",
          accuracy: "12",
        },
        {
          clientEventId: randomUUID(),
          seq: 2,
          kind: "clock_out",
          capturedAt: outAt,
          orgId: maya.orgId,
          userId: maya.userId,
          lat: "37.82",
          lng: "-122.247",
          accuracy: "12",
        },
      ],
      Date.now(),
    );
    expect(results.every((row) => row.status === "applied")).toBe(true);
    const synced = entry(results[0]?.entryId ?? "");
    expect(synced.source).toBe("offline");
    expect(synced.geoInVerdict).toBe("outside");
    expect(synced.geoOutVerdict).toBe("outside");
  });

  it("saves a pin from coordinates or a clock-in", () => {
    const maya = actor("maya@rivera.demo");
    expect(geoBoard(actor("dana@rivera.demo"))).toBeNull();
    setSitePin(maya, "proj_diaz", { lat: "37.770000", lng: "-122.230000", radius: "" });
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_diaz")).get()?.siteLatE6).toBe(37_770_000);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_diaz")).get()?.siteRadiusM).toBeNull();
    const view = sitePinView(maya, "proj_okonkwo");
    expect(view?.punches.length).toBeGreaterThan(0);
    adoptSitePin(maya, "proj_okonkwo", "time_ok_tile");
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get()?.siteLatE6).toBe(37_799_400);
    expect(() => setSitePin(actor("dana@rivera.demo"), "proj_diaz", { lat: "1", lng: "1", radius: "" })).toThrow(/office/);
  });
});
