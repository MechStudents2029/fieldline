import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { costItems, equipmentAssignments, invoiceCosts } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { costPlusBoard } from "@/lib/services/cost-plus";
import {
  checkIn,
  checkOut,
  equipmentChargeCents,
  equipmentDetail,
  equipmentOnJob,
  equipmentQueue,
  listEquipment,
  logEquipmentIds,
  nextServiceDay,
  reverseEquipmentCost,
  saveEquipment,
  serviceDueSoon,
  tagLogEquipment,
  type EquipmentInput,
} from "@/lib/services/equipment";
import { authenticate, projectDetail } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

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

function blank(over: Partial<EquipmentInput> = {}): EquipmentInput {
  return {
    name: "Tile saw",
    category: "Tools",
    makeModel: "",
    serial: "",
    tag: "",
    purchasedOn: null,
    costCents: null,
    rateCents: 2500,
    rateUnit: "hour",
    status: "available",
    serviceInterval: null,
    serviceUnit: null,
    lastServiceOn: null,
    notes: "",
    ...over,
  };
}

const move = {
  projectId: "proj_okonkwo" as string | null,
  userId: null as string | null,
  expectedReturn: null as string | null,
  transfer: false,
  hours: null as number | null,
  costCents: null as number | null,
};

describe("equipment", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("counts overdue returns, service due within 7 days, and gear left on a closed job", () => {
    const today = localDay(Date.now(), "America/New_York");
    const maya = actor("maya@rivera.demo");
    const queue = equipmentQueue("org_rivera", today);
    expect(queue.overdue).toEqual({ count: 1, href: "/equipment?due=overdue" });
    expect(queue.service).toEqual({ count: 1, href: "/equipment?service=due" });
    expect(queue.stranded).toEqual({ count: 1, href: "/equipment?where=closed" });
    expect(equipmentOnJob("org_rivera", "proj_okonkwo")).toBe(1);
    expect(equipmentOnJob("org_rivera", "proj_diaz")).toBe(1);
    expect(listEquipment(maya, { due: "overdue" }).map((row) => row.id)).toEqual(["eq_mixer"]);
    expect(listEquipment(maya, { service: "due" }).map((row) => row.id)).toEqual(["eq_saw"]);
    expect(listEquipment(maya, { where: "closed" }).map((row) => row.id)).toEqual(["eq_trailer"]);
    expect(listEquipment(actor("jordan@northline.demo"), {})).toEqual([]);
    const saw = { serviceInterval: 90, serviceUnit: "day", lastServiceOn: addCalendarDays(today, -88), hoursSinceService: 0 };
    expect(nextServiceDay(saw, today)).toBe(addCalendarDays(today, 2));
    expect(serviceDueSoon(saw, today)).toBe(true);
    expect(nextServiceDay({ serviceInterval: 10, serviceUnit: "hour", lastServiceOn: null, hoursSinceService: 10 }, today)).toBe(today);
    expect(serviceDueSoon({ serviceInterval: 10, serviceUnit: "hour", lastServiceOn: null, hoursSinceService: 0 }, today)).toBe(false);
    expect(equipmentChargeCents(1800, "hour", 4, 9)).toBe(7200);
    expect(equipmentChargeCents(4500, "day", 0, 3)).toBe(13500);
    expect(equipmentDetail(maya, "eq_saw")?.nextService).toBe(addCalendarDays(today, 2));
  });

  it("keeps one open assignment and transfers instead of a second checkout", () => {
    const maya = actor("maya@rivera.demo");
    const riley = actor("riley@rivera.demo");
    expect(() => checkOut(riley, { equipmentId: "eq_laser", ...move })).toThrow(/cannot check equipment out/);
    expect(() => checkOut(maya, { equipmentId: "eq_nailer", ...move })).toThrow(/Checkout is blocked/);
    expect(() => checkOut(maya, { equipmentId: "eq_ladder", ...move })).toThrow(/cannot be checked out/);
    expect(() => saveEquipment(maya, blank({ name: "Mud mixer", status: "in_service", rateCents: null, rateUnit: null }), "eq_mixer")).toThrow(/Check it in first/);
    checkOut(maya, { equipmentId: "eq_laser", ...move });
    expect(() => checkOut(maya, { equipmentId: "eq_laser", ...move })).toThrow(/Transfer it/);
    checkOut(maya, { equipmentId: "eq_laser", ...move, projectId: "proj_brooks", transfer: true });
    const detail = equipmentDetail(maya, "eq_laser");
    expect(detail?.status).toBe("on_job");
    expect(detail?.location).toContain("Brooks");
    const open = detail?.history.find((row) => row.open);
    expect(open?.from).toContain("Okonkwo");
    expect(open?.to).toContain("Brooks");
    expect(detail?.history.filter((row) => row.open)).toHaveLength(1);
    checkIn(maya, { equipmentId: "eq_laser", hours: null, costCents: null });
    expect(equipmentDetail(maya, "eq_laser")?.status).toBe("available");
    expect(equipmentDetail(maya, "eq_laser")?.location).toBe("Yard");
    const posted = getDb()
      .select()
      .from(costItems)
      .where(and(eq(costItems.orgId, "org_rivera"), eq(costItems.source, "equipment"), eq(costItems.projectId, "proj_brooks")))
      .all();
    expect(posted).toHaveLength(0);
  });

  it("posts one equipment cost, refuses a second post, and reverses unless the cost is on an invoice", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const before = projectDetail("org_rivera", "proj_ellis", "owner");
    const beforeActual = before?.financials?.actualCents ?? 0;
    const saved = saveEquipment(maya, blank());
    checkOut(maya, { equipmentId: saved.id, ...move, projectId: "proj_ellis" });
    expect(equipmentDetail(maya, saved.id)?.suggestedCents).toBe(2500);
    expect(equipmentDetail(dana, saved.id)?.rateCents).toBeNull();
    expect(equipmentDetail(dana, saved.id)?.costCents).toBeNull();
    expect(equipmentDetail(dana, saved.id)?.suggestedCents).toBeNull();
    const closed = checkIn(dana, { equipmentId: saved.id, hours: 3, costCents: 99_999 });
    const posted = getDb()
      .select()
      .from(costItems)
      .where(and(eq(costItems.orgId, "org_rivera"), eq(costItems.projectId, "proj_ellis"), eq(costItems.source, "equipment")))
      .all();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.amountCents).toBe(7500);
    expect(posted[0]?.costCode).toBe("EQ-TOOLS");
    expect(posted[0]?.memo).toBe("Equipment · Tile saw · h");
    const after = projectDetail("org_rivera", "proj_ellis", "owner");
    expect(after?.financials?.actualCents).toBe(beforeActual + 7500);
    expect(after?.financials?.byCode.find((row) => row.code === "EQ-TOOLS")?.actualCents).toBe(7500);
    const board = costPlusBoard(maya, "proj_ellis");
    expect(board?.costs.some((row) => row.label === "Equipment · Tile saw · h" && row.costCents === 7500)).toBe(true);
    getDb().update(equipmentAssignments).set({ checkedInAt: null }).where(eq(equipmentAssignments.id, closed.id)).run();
    checkIn(maya, { equipmentId: saved.id, hours: 1, costCents: 100 });
    const still = getDb()
      .select()
      .from(costItems)
      .where(and(eq(costItems.orgId, "org_rivera"), eq(costItems.projectId, "proj_ellis"), eq(costItems.source, "equipment")))
      .all();
    expect(still).toHaveLength(1);
    expect(still[0]?.amountCents).toBe(7500);
    const costId = still[0]?.id ?? "";
    getDb()
      .insert(invoiceCosts)
      .values({
        id: id("icost"),
        orgId: "org_rivera",
        projectId: "proj_ellis",
        invoiceId: "inv_ellis_draft",
        sourceKind: "equipment",
        sourceId: costId,
        costCode: "EQ-TOOLS",
        label: "Equipment · Tile saw · h",
        occurredOn: localDay(Date.now(), "America/New_York"),
        costCents: 7500,
        markupBps: 2000,
        markupCents: 1500,
        priceCents: 9000,
        nonBillable: 0,
        createdAt: nowIso(),
      })
      .run();
    expect(() => reverseEquipmentCost(maya, closed.id)).toThrow(/This cost is on/);
    getDb().delete(invoiceCosts).where(and(eq(invoiceCosts.orgId, "org_rivera"), eq(invoiceCosts.sourceId, costId))).run();
    reverseEquipmentCost(maya, closed.id);
    expect(
      getDb()
        .select()
        .from(costItems)
        .where(and(eq(costItems.orgId, "org_rivera"), eq(costItems.projectId, "proj_ellis"), eq(costItems.source, "equipment")))
        .all(),
    ).toHaveLength(0);
    getDb().update(equipmentAssignments).set({ checkedInAt: null }).where(eq(equipmentAssignments.id, closed.id)).run();
    checkIn(maya, { equipmentId: saved.id, hours: 8, costCents: 80_000 });
    expect(
      getDb()
        .select()
        .from(costItems)
        .where(and(eq(costItems.orgId, "org_rivera"), eq(costItems.projectId, "proj_ellis"), eq(costItems.source, "equipment")))
        .all(),
    ).toHaveLength(0);
    checkOut(maya, { equipmentId: saved.id, ...move, projectId: "proj_ellis" });
    checkIn(maya, { equipmentId: saved.id, hours: 1, costCents: null });
    const again = getDb()
      .select()
      .from(costItems)
      .where(and(eq(costItems.orgId, "org_rivera"), eq(costItems.projectId, "proj_ellis"), eq(costItems.source, "equipment")))
      .all();
    expect(again).toHaveLength(1);
    expect(again[0]?.amountCents).toBe(2500);
    expect(equipmentDetail(dana, saved.id)?.rateCents).toBeNull();
  });

  it("tags a daily log and records the job address as last seen", () => {
    const maya = actor("maya@rivera.demo");
    tagLogEquipment(maya, "log_ok_draft", ["eq_saw"]);
    const saw = equipmentDetail(maya, "eq_saw");
    expect(saw?.lastSeen).toBe("Okonkwo primary bath");
    expect(saw?.lastSeenAddress).toBe("901 Mandana Blvd, Oakland, CA");
    expect(saw?.lastSeenAt).toBeTruthy();
    expect(logEquipmentIds("org_rivera", "log_ok_draft")).toEqual(["eq_saw"]);
    expect(() => tagLogEquipment(actor("riley@rivera.demo"), "log_ok_draft", ["eq_saw"])).toThrow(/cannot check equipment out/);
  });
});
