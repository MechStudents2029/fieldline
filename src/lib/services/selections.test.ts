import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { changeOrders, costItems, projects, selectionEvents } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { chooseSelection, draftSelectionChangeOrder, lockSelection, portalSelections, releaseSelection, resetSelection, selectionBoard, approveSelection } from "@/lib/services/selections";
import { localDay } from "@/lib/time/calendar";

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

function today() {
  return localDay(Date.now(), "America/New_York");
}

function tileActual() {
  return getDb()
    .select()
    .from(costItems)
    .where(and(eq(costItems.projectId, "proj_okonkwo"), eq(costItems.costCode, "TILE-FLR"), eq(costItems.source, "selection")))
    .all()
    .reduce((sum, row) => sum + row.amountCents, 0);
}

describe("selections", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("seeds Okonkwo and Chen, and hides prices from field and cost from the client", () => {
    const maya = selectionBoard(actor("maya@rivera.demo"), "proj_okonkwo", today());
    expect(maya?.rows.map((row) => row.title).sort()).toEqual(["Floor tile", "Vanity"]);
    const floor = maya?.rows.find((row) => row.title === "Floor tile");
    expect(floor).toMatchObject({ status: "released", allowanceLabel: "$1,800", overdue: true });
    expect(floor?.choices.map((choice) => choice.deltaLabel)).toEqual(["−$400", "included", "+$600"]);
    const vanity = maya?.rows.find((row) => row.title === "Vanity");
    expect(vanity).toMatchObject({ status: "chosen", chosenName: "Quartz vanity", differenceLabel: "included" });
    expect(maya?.allowanceTotalCents).toBe(800_000);
    expect(maya?.chosenTotalCents).toBe(620_000);
    expect(maya?.differenceCents).toBe(0);
    const chen = selectionBoard(actor("maya@rivera.demo"), "proj_chen", today());
    expect(chen?.rows.map((row) => row.title)).toEqual(["Faucet"]);
    expect(chen?.rows[0]?.status).toBe("draft");
    expect(chen?.rows[0]?.overdue).toBe(false);

    const field = selectionBoard(actor("dana@rivera.demo"), "proj_okonkwo", today());
    expect(field?.showMoney).toBe(false);
    expect(field?.rows.find((row) => row.title === "Vanity")?.chosenName).toBe("Quartz vanity");
    expect(field?.rows.every((row) => row.allowancePriceCents == null && row.differenceCents == null)).toBe(true);
    expect(field?.rows.every((row) => row.choices.every((choice) => choice.unitPriceCents == null && choice.unitCostCents == null))).toBe(true);
    const fieldJson = JSON.stringify(field);
    for (const amount of ["140000", "165000", "280000", "180000", "90000"]) {
      expect(fieldJson).not.toContain(amount);
    }

    const portal = portalSelections("demo_portal_okonkwo");
    expect(portal?.map((row) => row.title).sort()).toEqual(["Floor tile", "Vanity"]);
    const portalJson = JSON.stringify(portal);
    expect(portalJson).toContain("240000");
    for (const hidden of ["165000", "280000", "90000", "120000", "unitCost"]) {
      expect(portalJson).not.toContain(hidden);
    }
    expect(portalSelections("demo_portal_chen")).toEqual([]);
    expect(portalSelections("missing-token")).toBeNull();
    expect(selectionBoard(actor("jordan@northline.demo"), "proj_okonkwo", today())).toBeNull();
    expect(selectionBoard(actor("riley@rivera.demo"), "proj_okonkwo", today())?.canEdit).toBe(false);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["selections", "selection_choices", "selection_events"]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("refuses field, viewer, and another company", () => {
    expect(() => releaseSelection(actor("dana@rivera.demo"), "sel_chen_faucet")).toThrow(/cannot change prices/);
    expect(() => releaseSelection(actor("riley@rivera.demo"), "sel_chen_faucet")).toThrow(/cannot change prices/);
    expect(() => releaseSelection(actor("jordan@northline.demo"), "sel_ok_floor")).toThrow(/not found/);
    expect(() => approveSelection(actor("maya@rivera.demo"), "sel_ok_floor", "choc_ok_marble", " ")).toThrow(/Add a note/);
  });

  it("posts the chosen cost, drafts only the overage, and resets both", () => {
    const maya = actor("maya@rivera.demo");
    const contractBefore = getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get()!.contractValueCents;
    expect(tileActual()).toBe(0);
    approveSelection(maya, "sel_ok_floor", "choc_ok_marble", "in person", "127.0.0.1");
    expect(tileActual()).toBe(165_000);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get()!.contractValueCents).toBe(contractBefore);
    const drafted = draftSelectionChangeOrder(maya, "sel_ok_floor");
    const order = getDb().select().from(changeOrders).where(eq(changeOrders.id, drafted.changeOrderId)).get()!;
    expect(order.status).toBe("draft");
    expect(order.priceDeltaCents).toBe(60_000);
    expect(draftSelectionChangeOrder(maya, "sel_ok_floor").changeOrderId).toBe(drafted.changeOrderId);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get()!.contractValueCents).toBe(contractBefore);
    const approved = getDb().select().from(selectionEvents).where(eq(selectionEvents.selectionId, "sel_ok_floor")).all();
    expect(approved.some((event) => event.action === "approve" && event.reason === "in person" && event.actorId === "user_maya")).toBe(true);

    resetSelection(maya, "sel_ok_floor", "client changed");
    expect(tileActual()).toBe(0);
    expect(getDb().select().from(changeOrders).where(eq(changeOrders.id, drafted.changeOrderId)).get()).toBeUndefined();
    expect(selectionBoard(maya, "proj_okonkwo", today())?.rows.find((row) => row.id === "sel_ok_floor")?.status).toBe("released");
    const reset = getDb().select().from(selectionEvents).where(eq(selectionEvents.selectionId, "sel_ok_floor")).all();
    expect(reset.some((event) => event.action === "reset" && event.reason === "client changed")).toBe(true);

    const first = chooseSelection({
      token: "demo_portal_okonkwo",
      selectionId: "sel_ok_floor",
      choiceId: "choc_ok_porcelain",
      typedName: "Amara Okonkwo",
      consent: true,
      ip: "10.0.0.8",
      userAgent: "vitest",
    });
    const second = chooseSelection({
      token: "demo_portal_okonkwo",
      selectionId: "sel_ok_floor",
      choiceId: "choc_ok_porcelain",
      typedName: "Amara Okonkwo",
      consent: true,
      ip: "10.0.0.8",
      userAgent: "vitest",
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(tileActual()).toBe(120_000);
    const chooseEvents = getDb()
      .select()
      .from(selectionEvents)
      .where(and(eq(selectionEvents.selectionId, "sel_ok_floor"), eq(selectionEvents.action, "choose")))
      .all();
    expect(chooseEvents).toHaveLength(1);
    expect(chooseEvents[0]).toMatchObject({ signerName: "Amara Okonkwo", ip: "10.0.0.8", userAgent: "vitest" });
    expect(chooseEvents[0]?.docHash).toBeTruthy();
    expect(chooseEvents[0]?.consentTextVersion).toBeTruthy();

    lockSelection(maya, "sel_ok_floor");
    expect(() =>
      chooseSelection({
        token: "demo_portal_okonkwo",
        selectionId: "sel_ok_floor",
        choiceId: "choc_ok_marble",
        typedName: "Amara Okonkwo",
        consent: true,
      }),
    ).toThrow(/locked/);
    expect(tileActual()).toBe(120_000);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get()!.contractValueCents).toBe(contractBefore);
    const locked = getDb().select().from(selectionEvents).where(eq(selectionEvents.selectionId, "sel_ok_floor")).all();
    expect(locked.some((event) => event.action === "lock")).toBe(true);
  });
});
