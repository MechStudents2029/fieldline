import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { useDatabaseFile, getDb } from "@/lib/db/client";
import { scheduleItems } from "@/lib/db/schema";
import { assignDispatch } from "@/lib/services/dispatch";
import { authenticate } from "@/lib/services/read";
import { saveScheduleItem } from "@/lib/services/schedule";
import { localDay } from "@/lib/time/calendar";
import { capacityForm, capacityWarning, overbookedThisWeek, saveCapacity, workloadBoard, workloadCsv } from "@/lib/services/workload";

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

describe("workload", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("shows Dana over capacity and Luis under it this week and next", () => {
    const maya = actor("maya@rivera.demo");
    const board = workloadBoard(maya, {});
    expect(board.weeks).toHaveLength(8);
    const dana = board.rows.find((row) => row.name === "Dana Cho");
    const luis = board.rows.find((row) => row.name === "Luis Ortega");
    const sam = board.rows.find((row) => row.name === "Sam Patel");
    expect(dana).toBeTruthy();
    expect(luis).toBeTruthy();
    expect(sam).toBeTruthy();
    expect(dana!.cells[0]!.over).toBe(true);
    expect(dana!.cells[1]!.over).toBe(true);
    expect(dana!.cells[0]!.capacity).toBe(40 * 60);
    expect(luis!.cells[0]!.booked).toBeGreaterThan(0);
    expect(luis!.cells[1]!.booked).toBeGreaterThan(0);
    expect(luis!.cells[0]!.over).toBe(false);
    expect(luis!.cells[1]!.over).toBe(false);
    expect(sam!.cells[0]!.capacity).toBe(16 * 60);
    expect(sam!.cells[0]!.pto).toBe(8 * 60);
    expect(sam!.cells[0]!.over).toBe(false);
    expect(sam!.cells[1]!.capacity).toBe(24 * 60);
    expect(sam!.cells[1]!.booked).toBeGreaterThan(0);
    expect(sam!.cells[1]!.over).toBe(false);
    const today = overbookedThisWeek(maya.orgId);
    expect(today.count).toBe(1);
    expect(today.names).toBe("Dana Cho");
    expect(today.href).toBe("/schedule/workload");
    const focus = workloadBoard(maya, { who: "user_dana", week: board.weeks[0]!.start });
    expect(focus.focus?.name).toBe("Dana Cho");
    expect(focus.focus?.items.some((item) => item.title === "Shop load")).toBe(true);
    const field = workloadBoard(maya, { role: "field" });
    expect(field.rows.some((row) => row.name === "Dana Cho")).toBe(true);
    expect(field.rows.some((row) => row.name === "Maya Rivera")).toBe(false);
    const vendors = workloadBoard(maya, { vendors: true });
    expect(vendors.rows.some((row) => row.kind === "vendor" && row.name === "Harbor Plumbing")).toBe(true);
  });

  it("keeps another company off the board and writes CSV", () => {
    const jordan = workloadBoard(actor("jordan@northline.demo"), {});
    expect(jordan.rows.some((row) => row.name === "Dana Cho")).toBe(false);
    const csv = workloadCsv(actor("maya@rivera.demo"), {});
    expect(csv.split("\n")[0]).toBe("person,role,week_start,booked_hours,capacity_hours,utilization_percent,over");
    expect(csv).toContain("Dana Cho");
    expect(csv).toContain("yes");
    expect(csv).not.toContain("NaN");
  });

  it("warns when a dispatch slot pushes the week over and still assigns it", () => {
    const maya = actor("maya@rivera.demo");
    const day = localDay(Date.now(), "America/New_York");
    const result = assignDispatch(maya, { cardId: "item:sch_disp_coil", assigneeId: "user_dana", start: "16:00", end: "17:00", day });
    expect(result.warning).toMatch(/Dana Cho/);
    expect(result.warning).toMatch(/\d+h \/ \d+h/);
    const board = workloadBoard(maya, {});
    const dana = board.rows.find((row) => row.name === "Dana Cho");
    expect(dana!.cells[0]!.items.some((item) => item.title === "Coil visit")).toBe(true);
  });

  it("warns on a schedule assignment past capacity and stays quiet under it", () => {
    const maya = actor("maya@rivera.demo");
    const day = localDay(Date.now(), "America/New_York");
    const saved = saveScheduleItem(maya, {
      projectId: "proj_chen",
      title: "Capacity spike",
      startDate: day,
      endDate: day,
      startTime: null,
      status: "planned",
      note: null,
      assigneeIds: ["user_luis"],
      plannedHours: "50",
    });
    expect(capacityWarning(maya, ["user_luis"], day, day)).toMatch(/Luis Ortega \d+h \/ 40h/);
    expect(getDb().select().from(scheduleItems).where(eq(scheduleItems.id, saved)).get()?.title).toBe("Capacity spike");
    expect(capacityWarning(maya, ["user_riley"], day, day)).toBeNull();
  });

  it("lets an owner set a per-person override and refuses field", () => {
    const dana = actor("dana@rivera.demo");
    expect(() => saveCapacity(dana, { hours: 40, workdays: [1, 2, 3, 4, 5], people: [] })).toThrow(/cannot change capacity/);
    const maya = actor("maya@rivera.demo");
    saveCapacity(maya, { hours: 40, workdays: [1, 2, 3, 4, 5], people: [{ userId: "user_dana", hours: "20" }] });
    const form = capacityForm(maya);
    expect(form?.people.find((person) => person.id === "user_dana")?.hours).toBe("20");
    const board = workloadBoard(maya, {});
    expect(board.rows.find((row) => row.name === "Dana Cho")?.cells[0]?.capacity).toBe(20 * 60);
    saveCapacity(maya, { hours: 40, workdays: [1, 2, 3, 4, 5], people: [{ userId: "user_dana", hours: "" }] });
    expect(capacityForm(maya)?.people.find((person) => person.id === "user_dana")?.hours).toBe("");
  });
});
