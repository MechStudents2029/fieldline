import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile, getDb } from "@/lib/db/client";
import { auditLogs, timeEntries } from "@/lib/db/schema";
import { recentMonthDay } from "@/lib/liens/deadlines";
import { ServiceError } from "@/lib/services/errors";
import { lienAttention, lienCsv, lienJob, lienJobs, markLienSent, saveLienJob, saveLienRule } from "@/lib/services/liens";
import { authenticate } from "@/lib/services/read";
import { localDay } from "@/lib/time/calendar";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("lien deadlines", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds a protected, at-risk, missing, and paid job", () => {
    const maya = actor("maya@rivera.demo");
    const today = localDay(Date.now(), "America/New_York");
    const ca = lienJob(maya, "proj_lien_ca");
    const tx = lienJob(maya, "proj_lien_tx");
    const fl = lienJob(maya, "proj_lien_fl");
    const paid = lienJob(maya, "proj_lien_paid");
    expect(ca?.status).toBe("protected");
    expect(tx?.status).toBe("at-risk");
    expect(tx?.openCents).toBe(86_000);
    expect(tx?.deadlines.find((row) => row.kind === "prelim")?.date).toBe(recentMonthDay(today, 15));
    expect(fl?.status).toBe("missing");
    expect(paid?.status).toBe("paid");
    expect(lienAttention(maya)).toEqual({ count: 1, href: "/liens" });
    expect(lienJobs(maya).map((row) => row.projectId).sort()).toEqual(["proj_lien_ca", "proj_lien_fl", "proj_lien_paid", "proj_lien_tx"]);
    expect(lienCsv(maya)).toContain("Hale warehouse");
    expect(lienCsv(maya, { state: "FL" })).toContain("Vega condo");
    expect(lienCsv(maya, { state: "FL" })).not.toContain("Hale warehouse");
  });

  it("marks the notice sent and drops the today count", () => {
    const maya = actor("maya@rivera.demo");
    const before = lienJob(maya, "proj_lien_tx");
    const deadline = before?.deadlines.find((row) => row.kind === "prelim")?.date || "";
    markLienSent(maya, "proj_lien_tx", { kind: "prelim", sentOn: deadline, method: "certified", upload: null });
    expect(lienJob(maya, "proj_lien_tx")?.status).toBe("protected");
    expect(lienAttention(maya).count).toBe(0);
    const audits = getDb().select().from(auditLogs).where(eq(auditLogs.action, "lien.sent")).all();
    expect(audits.some((row) => row.entityId === "proj_lien_tx")).toBe(true);
  });

  it("audits an override and keeps field and viewers out of edits", () => {
    const maya = actor("maya@rivera.demo");
    saveLienJob(maya, "proj_lien_fl", { state: "FL", role: "sub", first: "2026-08-01", last: "2026-10-01" });
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "lien.override")).all().some((row) => row.entityId === "proj_lien_fl")).toBe(true);
    expect(lienJob(maya, "proj_lien_fl")?.status).toBe("lapsed");
    expect(() => saveLienRule(actor("riley@rivera.demo"), {
      state: "CA",
      role: "sub",
      prelimKind: "calendar",
      prelimDays: "20",
      prelimMonths: "0",
      prelimDay: "0",
      noiKind: "none",
      noiDays: "0",
      fileKind: "calendar",
      fileAnchor: "completion",
      fileDays: "90",
      fileMonths: "0",
      fileDay: "0",
      enforceKind: "calendar",
      enforceFrom: "filed",
      enforceDays: "90",
      prelimLapses: false,
      citation: "Civ. Code §§ 8204, 8414, 8460",
    })).toThrow(ServiceError);
    expect(lienJob(actor("riley@rivera.demo"), "proj_lien_ca")?.canEdit).toBe(false);
    expect(() => lienJobs(actor("dana@rivera.demo"))).toThrow(ServiceError);
    expect(lienAttention(actor("dana@rivera.demo"))).toEqual({ count: 0, href: null });
  });

  it("takes the first furnish date from a time entry", () => {
    const maya = actor("maya@rivera.demo");
    const stamp = "2026-09-15T15:00:00.000Z";
    getDb()
      .insert(timeEntries)
      .values({
        id: "time_lien_fl",
        orgId: maya.orgId,
        userId: "user_dana",
        projectId: "proj_lien_fl",
        costCode: "GC-SUPER",
        status: "approved",
        clockInAt: stamp,
        source: "office",
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: "user_maya",
      })
      .run();
    saveLienJob(maya, "proj_lien_fl", { state: "FL", role: "sub", first: "", last: "" });
    expect(lienJob(maya, "proj_lien_fl")?.first).toBe(localDay(Date.parse(stamp), "America/New_York"));
  });
});
