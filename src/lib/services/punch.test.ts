import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, costItems, messages, organizations, projects, scheduleAssignees, scheduleItems } from "@/lib/db/schema";
import { addMonths } from "@/lib/closeout/check";
import { localDay } from "@/lib/time/calendar";
import { authenticate } from "@/lib/services/read";
import { memberAssignments } from "@/lib/services/schedule";
import {
  addPunchItem,
  closeJob,
  declineWarranty,
  fieldPunch,
  markPunchDone,
  markSubstantial,
  portalWarranty,
  punchBoard,
  reopenJob,
  resolveWarranty,
  scheduleWarranty,
  setPunchShared,
  setWarrantyMonths,
  submitWarranty,
  verifyPunch,
  warrantyQueue,
} from "@/lib/services/punch";
import { ServiceError } from "@/lib/services/errors";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

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

function counts(board: NonNullable<ReturnType<typeof punchBoard>>) {
  return board.closeout.checklist.map((row) => [row.key, row.count]);
}

describe("punch list and warranty", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the new tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["punch_items", "warranty_requests", "warranty_photos", "warranty_attempts"]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("seeds mixed punch items and a closed Diaz warranty", () => {
    const maya = actor("maya@rivera.demo");
    const ok = punchBoard(maya, "proj_okonkwo");
    const diaz = punchBoard(maya, "proj_diaz");
    expect(ok?.counts).toEqual({ open: 3, done: 1, verified: 1 });
    expect(counts(ok!)).toEqual([
      ["punch", 4],
      ["invoice", 1],
      ["changes", 1],
      ["bills", 1],
      ["orders", 2],
      ["time", 3],
      ["permits", 0],
      ["inspections", 0],
    ]);
    expect(diaz?.closeout.closed).toBe(true);
    expect(diaz?.closeout.blocked).toBe(false);
    expect(diaz?.closeout.checklist.every((row) => row.count === 0)).toBe(true);
    expect(diaz?.warranty.map((row) => row.title)).toEqual(["Loose deck board"]);
    expect(warrantyQueue("org_rivera")).toEqual({ count: 1, href: "/projects/proj_diaz#warranty" });
    expect(warrantyQueue("org_northline")).toEqual({ count: 0, href: null });
  });

  it("keeps another company and a field login away from money and internal notes", () => {
    const jordan = actor("jordan@northline.demo");
    const dana = actor("dana@rivera.demo");
    expect(punchBoard(jordan, "proj_okonkwo")).toBeNull();
    expect(fieldPunch(jordan).items).toEqual([]);
    expect(() => addPunchItem(jordan, "proj_okonkwo", { title: "Nope", location: "", dueDate: null, costCode: null, assigneeUserId: null, assigneeContactId: null, shared: false })).toThrow(ServiceError);
    const board = punchBoard(dana, "proj_diaz");
    expect(JSON.stringify(board)).not.toMatch(/\$/);
    expect(board?.items.every((item) => item.costCode == null)).toBe(true);
    expect(board?.warranty.every((row) => row.amountCents == null && row.internalNote == null && row.costCode == null)).toBe(true);
    expect(board?.warranty[0]?.title).toBe("Loose deck board");
    expect(() => verifyPunch(dana, "punch_ok_paint")).toThrow(/cannot change/);
    expect(() => closeJob(actor("riley@rivera.demo"), "proj_okonkwo", { months: 12, reason: "no" })).toThrow(/cannot change/);
  });

  it("shows the homeowner shared punch and their request, not the internal note", () => {
    const home = portalWarranty("demo_portal_diaz");
    expect(home?.open).toBe(true);
    expect(home?.punch.map((item) => item.title).sort()).toEqual(["Seal the post cap", "Tighten the rail"]);
    expect(JSON.stringify(home)).not.toContain("ledger");
    expect(JSON.stringify(home)).not.toMatch(/\$|amountCents|costCode|internal/);
    const bath = portalWarranty("demo_portal_okonkwo");
    expect(bath?.closed).toBe(false);
    expect(bath?.open).toBe(false);
    expect(bath?.punch.map((item) => item.title).sort()).toEqual(["Align the vanity door", "Caulk the curb", "Seal the mirror edge"]);
  });

  it("verifies, shares, and posts a done photo", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    markPunchDone(dana, "punch_ok_curb", { filename: "curb.png", bytes: png });
    expect(punchBoard(maya, "proj_okonkwo")?.items.find((item) => item.id === "punch_ok_curb")?.status).toBe("done");
    expect(() => markPunchDone(dana, "punch_ok_curb", { filename: "x.svg", bytes: Buffer.from("<svg></svg>") })).toThrow(/JPEG/);
    verifyPunch(maya, "punch_ok_curb");
    expect(punchBoard(maya, "proj_okonkwo")?.items.find((item) => item.id === "punch_ok_curb")?.status).toBe("verified");
    setPunchShared(maya, "punch_ok_paint", true);
    expect(portalWarranty("demo_portal_okonkwo")?.punch.some((item) => item.title === "Touch up the ceiling")).toBe(true);
    const actions = getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, "org_rivera"))
      .all()
      .map((row) => row.action);
    expect(actions).toContain("punch.done");
    expect(actions).toContain("punch.verify");
    expect(actions).toContain("punch.share");
  });

  it("refuses to close until substantial, then records an override and a reopen", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => closeJob(maya, "proj_okonkwo", { months: 12, reason: "" })).toThrow(/substantially complete/);
    markSubstantial(maya, "proj_okonkwo");
    expect(() => closeJob(maya, "proj_okonkwo", { months: 12, reason: "" })).toThrow(/Clear the blockers/);
    closeJob(maya, "proj_okonkwo", { months: 6, reason: "Owner waived the open punch." });
    const closed = getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get();
    expect(closed?.status).toBe("complete");
    expect(closed?.closeOverrideReason).toMatch(/waived/);
    expect(closed?.warrantyMonths).toBe(6);
    expect(closed?.warrantyEndsOn).toBe(addMonths(localDay(Date.now(), "America/New_York"), 6));
    const audit = getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, "org_rivera"), eq(auditLogs.action, "job.close")))
      .all()
      .at(-1);
    expect(JSON.parse(audit?.payloadJson ?? "{}").reason).toMatch(/waived/);
    reopenJob(maya, "proj_okonkwo");
    const opened = getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get();
    expect(opened?.status).toBe("active");
    expect(opened?.closedAt).toBeNull();
    expect(opened?.warrantyEndsOn).toBeNull();
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "job.reopen")).all().length).toBeGreaterThan(0);
  });

  it("schedules a visit on the crew calendar and posts warranty cost", () => {
    const maya = actor("maya@rivera.demo");
    const today = localDay(Date.now(), "America/New_York");
    const note = scheduleWarranty(maya, "wr_dz_board", { assigneeUserId: "user_dana", visitDate: today });
    expect(note).toContain("Loose deck board");
    const request = punchBoard(maya, "proj_diaz")?.warranty[0];
    expect(request?.status).toBe("scheduled");
    expect(request?.internalNote).toContain("ledger");
    const item = getDb().select().from(scheduleItems).where(and(eq(scheduleItems.orgId, "org_rivera"), eq(scheduleItems.title, "Loose deck board"))).get();
    expect(item?.startDate).toBe(today);
    const assignee = getDb().select().from(scheduleAssignees).where(eq(scheduleAssignees.itemId, item!.id)).get();
    expect(assignee?.userId).toBe("user_dana");
    expect(memberAssignments(actor("dana@rivera.demo")).today.some((row) => row.title === "Loose deck board")).toBe(true);
    resolveWarranty(maya, "wr_dz_board", { clientNote: "Replaced the board.", internalNote: "Used a spare.", costCode: "DECK-BOARD", amountCents: 4500 });
    const cost = getDb().select().from(costItems).where(and(eq(costItems.projectId, "proj_diaz"), eq(costItems.source, "warranty"))).get();
    expect(cost?.amountCents).toBe(4500);
    expect(cost?.costCode).toBe("DECK-BOARD");
    const home = portalWarranty("demo_portal_diaz");
    expect(home?.requests[0]?.clientNote).toBe("Replaced the board.");
    expect(home?.requests[0]?.status).toBe("resolved");
    expect(JSON.stringify(home)).not.toContain("spare");
    expect(JSON.stringify(home)).not.toContain("4500");
    expect(warrantyQueue("org_rivera").count).toBe(0);
  });

  it("accepts a portal request inside the window and refuses one outside it", () => {
    const before = getDb().select().from(messages).where(eq(messages.orgId, "org_rivera")).all().length;
    const started = Date.now() - 10_000;
    const created = submitWarranty({
      token: "demo_portal_diaz",
      ip: "203.0.113.10",
      honeypot: "",
      startedAt: String(started),
      title: "Squeaky stair",
      description: "The third tread squeaks.",
      urgency: "urgent",
      photos: [{ filename: "stair.png", bytes: png }],
      now: Date.now(),
    });
    expect("id" in created).toBe(true);
    expect(getDb().select().from(messages).where(eq(messages.orgId, "org_rivera")).all().length).toBe(before);
    const home = portalWarranty("demo_portal_diaz");
    expect(home?.requests.some((row) => row.title === "Squeaky stair" && row.status === "submitted")).toBe(true);
    expect(submitWarranty({
      token: "demo_portal_diaz",
      ip: "203.0.113.11",
      honeypot: "http://spam",
      startedAt: String(started),
      title: "Bot",
      description: "",
      urgency: "normal",
      photos: [],
      now: Date.now(),
    })).toEqual({ dropped: "honeypot" });
    const project = getDb().select().from(projects).where(eq(projects.id, "proj_diaz")).get();
    const ends = project?.warrantyEndsOn;
    getDb().update(projects).set({ warrantyEndsOn: "2000-01-01" }).where(eq(projects.id, "proj_diaz")).run();
    expect(portalWarranty("demo_portal_diaz")?.open).toBe(false);
    expect(() =>
      submitWarranty({
        token: "demo_portal_diaz",
        ip: "203.0.113.12",
        honeypot: "",
        startedAt: String(started),
        title: "Late",
        description: "",
        urgency: "normal",
        photos: [],
        now: Date.now(),
      }),
    ).toThrow(/ended/);
    getDb().update(projects).set({ warrantyEndsOn: ends }).where(eq(projects.id, "proj_diaz")).run();
    expect(() =>
      submitWarranty({
        token: "demo_portal_diaz",
        ip: "203.0.113.13",
        honeypot: "",
        startedAt: String(Date.now() - 10_000),
        title: "Too many photos",
        description: "",
        urgency: "normal",
        photos: [{ filename: "a.png", bytes: png }, { filename: "b.png", bytes: png }, { filename: "c.png", bytes: png }, { filename: "d.png", bytes: png }],
        now: Date.now(),
      }),
    ).toThrow(/Three photos/);
  });

  it("rate limits a noisy address and lets the company default change", () => {
    const now = Date.now();
    const started = now - 10_000;
    for (let i = 0; i < 8; i += 1) {
      expect(() =>
        submitWarranty({
          token: "demo_portal_diaz",
          ip: "203.0.113.50",
          honeypot: "",
          startedAt: String(now),
          title: "Again",
          description: "",
          urgency: "normal",
          photos: [],
          now,
        }),
      ).toThrow(/Wait a moment/);
    }
    expect(() =>
      submitWarranty({
        token: "demo_portal_diaz",
        ip: "203.0.113.50",
        honeypot: "",
        startedAt: String(started),
        title: "Ninth",
        description: "",
        urgency: "normal",
        photos: [],
        now,
      }),
    ).toThrow(/Too many/);
    const maya = actor("maya@rivera.demo");
    setWarrantyMonths(maya, 18);
    expect(getDb().select().from(organizations).where(eq(organizations.id, "org_rivera")).get()?.warrantyMonths).toBe(18);
    expect(() => setWarrantyMonths(actor("luis@rivera.demo"), 12)).toThrow(/owner or admin/);
    expect(() => declineWarranty(maya, "missing", { clientNote: "No.", internalNote: "" })).toThrow(/not in your company/);
  });
});
