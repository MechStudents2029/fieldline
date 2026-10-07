import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, invoices, payAppLines, projects, scheduleItems } from "@/lib/db/schema";
import { qboInvoicesCsv } from "@/lib/services/read";
import { authenticate } from "@/lib/services/read";
import {
  billDraw,
  createPayApp,
  drawSchedule,
  portalBilling,
  progressSheet,
  readyToBill,
  releaseRetainage,
  saveBillingDefaults,
  saveDrawSchedule,
  setBillingMode,
  voidBilling,
} from "@/lib/services/draws";
import { approveChangeOrder, createChangeOrder, sendChangeOrder } from "@/lib/services/write";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("draws and progress billing", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps draw amounts behind the money policy", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const money = sql.slice(sql.lastIndexOf("foreach tbl in array array["));
    expect(money).toContain("'draws'");
    expect(money).toContain("'pay_app_lines'");
  });

  it("seeds Okonkwo ready to bill and Brooks retainage without leaking to another company or the field", () => {
    const maya = actor("maya@rivera.demo");
    const board = drawSchedule(maya, "proj_okonkwo");
    expect(board?.draws).toHaveLength(5);
    expect(board?.remainderCents).toBe(0);
    expect(board?.draws.reduce((sum, draw) => sum + draw.amountCents, 0)).toBe(board?.contractCents);
    const tile = board?.draws.find((draw) => draw.title === "Tile set");
    expect(tile?.phase).toBe("ready");
    expect(readyToBill("org_rivera")).toMatchObject({ count: 1, cents: 420_000, href: "/projects/proj_okonkwo/draws" });
    const brooks = progressSheet(maya, "proj_brooks");
    expect(brooks?.retainageBps).toBe(1000);
    expect(brooks?.lines.find((line) => line.name === "Framing")?.previousCents).toBe(1_144_000);
    expect(brooks?.heldCents).toBe(344_000);
    expect(drawSchedule(actor("jordan@northline.demo"), "proj_okonkwo")).toBeNull();
    const field = drawSchedule(actor("dana@rivera.demo"), "proj_okonkwo");
    expect(field?.showMoney).toBe(false);
    expect(JSON.stringify(field)).not.toContain("420000");
    expect(JSON.stringify(field)).not.toContain("1680000");
    const portal = portalBilling("demo_portal_okonkwo");
    expect(portal?.draws.map((draw) => draw.title)).toContain("Tile set");
    expect(JSON.stringify(portal)).not.toContain("margin");
    expect(JSON.stringify(portalBilling("demo_portal_north_home"))).not.toContain("Tile set");
    expect(JSON.stringify(portal)).not.toContain("unitCost");
  });

  it("blocks a schedule that misses the contract, bills a ready draw, and rolls a change order once", async () => {
    const maya = actor("maya@rivera.demo");
    const contract = drawSchedule(maya, "proj_okonkwo")!.contractCents;
    expect(() =>
      saveDrawSchedule(maya, "proj_okonkwo", [
        { id: "drw_ok_dep", title: "Deposit", basis: "fixed", bps: 0, amountCents: 1_680_000, scheduleItemId: null, dueOn: null },
        { id: "drw_ok_rough", title: "Rough-in", basis: "fixed", bps: 0, amountCents: 1_680_000, scheduleItemId: null, dueOn: null },
        { id: "drw_ok_tile", title: "Tile set", basis: "fixed", bps: 0, amountCents: 420_000, scheduleItemId: "sch_ok_demo", dueOn: null },
        { id: "drw_ok_trim", title: "Trim", basis: "fixed", bps: 0, amountCents: 1, scheduleItemId: null, dueOn: "2026-11-01" },
        { id: "drw_ok_final", title: "Final", basis: "fixed", bps: 0, amountCents: 420_000, scheduleItemId: null, dueOn: "2026-12-01" },
      ]),
    ).toThrow(/equal the contract/);
    const billed = billDraw(maya, "drw_ok_tile");
    const invoice = getDb().select().from(invoices).where(eq(invoices.id, billed.invoiceId)).get();
    expect(invoice).toMatchObject({ status: "draft", totalCents: 420_000, projectId: "proj_okonkwo" });
    expect(drawSchedule(maya, "proj_okonkwo")?.draws.find((draw) => draw.id === "drw_ok_tile")?.phase).toBe("invoiced");
    expect(readyToBill("org_rivera").count).toBe(0);
    const created = createChangeOrder(maya, "proj_okonkwo", {
      title: "Move the valve",
      description: "Shift the valve 6 inches.",
      name: "Move the valve",
      qty: 1,
      unit: "ea",
      unitCostCents: 10_000,
      markupBps: 0,
      costCode: "PLB-SHOWER",
    });
    await sendChangeOrder(maya, created.changeOrderId);
    approveChangeOrder({ token: created.publicToken, typedName: "Amara Okonkwo", consent: true });
    const after = drawSchedule(maya, "proj_okonkwo");
    expect(after?.contractCents).toBe(contract + 10_000);
    expect(after?.remainderCents).toBe(0);
    expect(after?.draws.some((draw) => draw.title.startsWith("CO "))).toBe(true);
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, "org_rivera"), eq(auditLogs.action, "draw.invoice"))).all().length).toBeGreaterThan(0);
  });

  it("bills a progress application, blocks over 100%, voids back to the prior column, and releases retainage", () => {
    const maya = actor("maya@rivera.demo");
    const sheet = progressSheet(maya, "proj_brooks")!;
    const framing = sheet.lines.find((line) => line.name === "Framing")!;
    expect(() => createPayApp(maya, "proj_brooks", [{ key: framing.key, thisCents: framing.scheduledCents, percentBps: null }])).toThrow(/over 100%/);
    const issued = createPayApp(maya, "proj_brooks", [{ key: framing.key, thisCents: 10_000, percentBps: null }]);
    const lines = getDb().select().from(payAppLines).where(eq(payAppLines.invoiceId, issued.invoiceId)).all();
    const framingLine = lines.find((line) => line.sourceKey === framing.key);
    expect(framingLine).toMatchObject({ previousCents: 1_144_000, thisCents: 10_000, retainageCents: 1_000 });
    expect(getDb().select().from(invoices).where(eq(invoices.id, issued.invoiceId)).get()?.totalCents).toBe(9_000);
    expect(qboInvoicesCsv("org_rivera")).toContain(issued.number);
    const next = progressSheet(maya, "proj_brooks")!;
    expect(next.lines.find((line) => line.key === framing.key)?.previousCents).toBe(1_154_000);
    voidBilling(maya, issued.invoiceId);
    expect(progressSheet(maya, "proj_brooks")?.lines.find((line) => line.key === framing.key)?.previousCents).toBe(1_144_000);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "invoice.void")).all().length).toBeGreaterThan(0);
    setBillingMode(maya, "proj_diaz", "progress", 1000);
    const diaz = progressSheet(maya, "proj_diaz")!;
    const first = diaz.lines[0];
    if (!first) throw new Error("missing line");
    createPayApp(maya, "proj_diaz", [{ key: first.key, thisCents: 10_000, percentBps: null }]);
    const released = releaseRetainage(maya, "proj_diaz");
    expect(getDb().select().from(invoices).where(eq(invoices.id, released.invoiceId)).get()).toMatchObject({ type: "retainage", totalCents: 1_000 });
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "retainage.release")).all().length).toBeGreaterThan(0);
    const chen = getDb().select().from(projects).where(eq(projects.id, "proj_chen")).get()!;
    const half = Math.round((chen.contractValueCents * 5000) / 10000);
    saveDrawSchedule(maya, "proj_chen", [
      { title: "Start", basis: "percent", bps: 5000, amountCents: 0, scheduleItemId: null, dueOn: null },
      { title: "End", basis: "fixed", bps: 0, amountCents: chen.contractValueCents - half, scheduleItemId: null, dueOn: "2026-12-01" },
    ]);
    expect(drawSchedule(maya, "proj_chen")?.remainderCents).toBe(0);
    getDb().update(scheduleItems).set({ status: "done", endDate: "2026-10-01" }).where(eq(scheduleItems.id, "sch_chen_measure")).run();
    saveDrawSchedule(
      maya,
      "proj_chen",
      (drawSchedule(maya, "proj_chen")?.draws ?? []).map((draw) => ({
        id: draw.id,
        title: draw.title,
        basis: draw.basis,
        bps: draw.bps,
        amountCents: draw.amountCents,
        scheduleItemId: draw.title === "End" ? "sch_chen_measure" : null,
        dueOn: draw.dueOn,
      })),
    );
    expect(drawSchedule(maya, "proj_chen")?.draws.find((draw) => draw.title === "End")?.phase).toBe("ready");
    expect(() => saveBillingDefaults(actor("dana@rivera.demo"), { draws: [{ title: "All", bps: 10000 }], termsDays: 7, retainageBps: 0 })).toThrow(/owner or admin/);
    saveBillingDefaults(maya, { draws: [{ title: "Deposit", bps: 4000 }, { title: "Progress", bps: 4000 }, { title: "Final", bps: 2000 }], termsDays: 7, retainageBps: 0 });
  });
});
