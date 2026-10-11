import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, changeOrderLines, changeOrders, invoiceLines, invoices, notifications, tasks, tmTickets } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { ServiceError } from "@/lib/services/errors";
import { voidBilling } from "@/lib/services/draws";
import { saveAutomation } from "@/lib/services/automations";
import {
  addTicketLine,
  addTicketsToCostPlus,
  convertTicketsToChangeOrder,
  createTicket,
  listTickets,
  portalSignTicket,
  portalTmTickets,
  requestTicketSignature,
  signTicket,
  ticketDetail,
  unbilledTm,
  voidChangeOrder,
  voidTicket,
} from "@/lib/services/tm";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

function openTicket(user: ReturnType<typeof actor>, projectId: string, orderedById: string, description: string) {
  return createTicket(user, {
    projectId,
    performedOn: "2026-10-11",
    location: "Site",
    orderedById,
    description,
  }).id;
}

describe("T&M tickets", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("hides prices from the field and bills a verified ticket as a change order", () => {
    const dana = actor("dana@rivera.demo");
    const maya = actor("maya@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const id = openTicket(dana, "proj_okonkwo", "c_okonkwo", "Extra niche");
    addTicketLine(dana, id, { kind: "labor", userId: "user_dana", hours: 2, unitCostCents: 1, markupBps: 9000 });
    addTicketLine(dana, id, { kind: "material", catalogCode: "tile-shower", qty: 4, unitCostCents: 1 });
    const field = ticketDetail(dana, id);
    expect(field?.money).toBeNull();
    expect(field?.lines).toHaveLength(2);
    expect(JSON.stringify(field)).not.toMatch(/unitCostCents|unitPriceCents|priceCents|costCents|marginBps/);
    expect(listTickets(dana, {}).rows.find((row) => row.id === id)?.priceCents).toBeNull();
    const office = ticketDetail(maya, id);
    const labor = office?.lines.find((line) => line.kind === "labor");
    expect(labor && "unitPriceCents" in labor && labor.unitPriceCents).toBe(8500);
    expect(labor && "unitCostCents" in labor && labor.unitCostCents).toBe(5200);
    expect(office?.money?.priceCents).toBe(17000 + 12960);
    expect(ticketDetail(jordan, id)).toBeNull();
    expect(() => addTicketLine(jordan, id, { kind: "labor", userId: "user_dana", hours: 1 })).toThrow(ServiceError);

    signTicket(dana, id, "company", { name: "Dana Cho", drawn: PNG });
    expect(ticketDetail(maya, id)?.pill).toBe("Ready for review");
    expect(() => signTicket(dana, id, "client", { name: "A", drawn: PNG })).toThrow(/name/);
    signTicket(dana, id, "client", { name: "Amara Okonkwo", drawn: PNG });
    expect(ticketDetail(maya, id)?.status).toBe("verified");
    expect(() => addTicketLine(maya, id, { kind: "labor", userId: "user_dana", hours: 1 })).toThrow(/locked/);
    expect(getDb().select().from(notifications).where(eq(notifications.kind, "tm")).all().some((row) => row.snippet.includes("TM-"))).toBe(true);
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "tm.client_sign" && row.entityId === id)).toBe(true);
    expect(unbilledTm("org_rivera").count).toBeGreaterThan(0);

    const converted = convertTicketsToChangeOrder(maya, [id]);
    const order = getDb().select().from(changeOrders).where(eq(changeOrders.id, converted.changeOrderId)).get();
    const lines = getDb().select().from(changeOrderLines).where(eq(changeOrderLines.changeOrderId, converted.changeOrderId)).all();
    expect(order?.status).toBe("draft");
    expect(order?.priceDeltaCents).toBe(17000 + 12960);
    expect(order?.costDeltaCents).toBe(10400 + 9600);
    expect(lines.every((line) => line.markupBps === 0)).toBe(true);
    expect(lines.reduce((sum, line) => sum + line.priceCents, 0)).toBe(order?.priceDeltaCents);
    expect(ticketDetail(maya, id)?.status).toBe("billed");
    expect(ticketDetail(maya, id)?.changeOrderLabel).toMatch(/^CO-/);
    voidChangeOrder(maya, converted.changeOrderId);
    expect(ticketDetail(maya, id)?.status).toBe("verified");
    expect(ticketDetail(maya, id)?.changeOrderId).toBeNull();
    expect(() => voidChangeOrder(maya, converted.changeOrderId)).toThrow(/already void/);
  });

  it("adds a verified ticket to the cost-plus draft and returns it when the invoice is voided", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const id = openTicket(dana, "proj_ellis", "c_ellis", "Filler panel on site");
    addTicketLine(dana, id, { kind: "material", label: "Note", qty: 1 });
    const blank = ticketDetail(maya, id);
    expect(blank?.lines[0] && "priceCents" in blank.lines[0] ? blank.lines[0].priceCents : -1).toBe(0);
    addTicketLine(maya, id, { kind: "material", label: "Cabinet filler", qty: 1, unitCostCents: 4000, markupBps: 2000 });
    signTicket(maya, id, "client", { name: "Nora Ellis", drawn: PNG });
    expect(() => convertTicketsToChangeOrder(maya, [id, "tm_missing"])).toThrow(ServiceError);
    const other = openTicket(dana, "proj_okonkwo", "c_okonkwo", "Different job");
    addTicketLine(dana, other, { kind: "labor", userId: "user_dana", hours: 1 });
    signTicket(dana, other, "client", { name: "Amara Okonkwo", drawn: PNG });
    expect(() => addTicketsToCostPlus(maya, [id, other])).toThrow(/same job/);
    expect(() => addTicketsToCostPlus(maya, [other])).toThrow(/not cost-plus/);
    const invoiceBefore = getDb().select().from(invoices).where(eq(invoices.id, "inv_ellis_draft")).get()!;
    const billed = addTicketsToCostPlus(maya, [id]);
    expect(billed.invoiceId).toBe("inv_ellis_draft");
    const invoice = getDb().select().from(invoices).where(eq(invoices.id, "inv_ellis_draft")).get()!;
    expect(invoice.subtotalCents).toBe(invoiceBefore.subtotalCents + 4800);
    expect(getDb().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, "inv_ellis_draft")).all().some((line) => line.description.includes("Cabinet filler"))).toBe(true);
    expect(ticketDetail(maya, id)?.invoiceLabel).toBe("RR-1070");
    voidBilling(maya, "inv_ellis_draft");
    expect(ticketDetail(maya, id)?.status).toBe("verified");
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "tm.restore" && row.entityId === id)).toBe(true);
    voidTicket(maya, id);
    expect(ticketDetail(maya, id)?.status).toBe("void");
    expect(() => voidTicket(maya, other)).not.toThrow();
  });

  it("lets the homeowner sign from the portal and fires the verified trigger", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    saveAutomation(maya, {
      name: "Bill verified T&M",
      enabled: true,
      trigger: { kind: "tm_verified" },
      conditions: [],
      actions: [{ kind: "todo", title: "Bill the extra work", who: "", dueDays: 1 }],
    });
    const id = openTicket(dana, "proj_brooks", "c_brooks", "Pad compaction");
    addTicketLine(dana, id, { kind: "equipment", equipmentId: "eq_compactor", qty: 1 });
    requestTicketSignature(dana, id);
    expect(getDb().select().from(auditLogs).all().some((row) => row.action === "tm.request" && row.entityId === id)).toBe(true);
    const listed = portalTmTickets("demo_portal_brooks");
    expect(listed.some((row) => row.id === id && row.canSign)).toBe(true);
    expect(listed.find((row) => row.id === id)?.money?.priceCents).toBe(7500);
    expect(() => portalSignTicket("demo_portal_okonkwo", id, { name: "Amara Okonkwo", drawn: PNG })).toThrow(/not found/i);
    portalSignTicket("demo_portal_brooks", id, { name: "Chris Brooks", drawn: PNG });
    expect(portalTmTickets("demo_portal_brooks").find((row) => row.id === id)?.canSign).toBe(false);
    expect(getDb().select().from(tmTickets).where(eq(tmTickets.id, id)).get()?.status).toBe("verified");
    expect(getDb().select().from(tasks).all().some((row) => row.title === "Bill the extra work")).toBe(true);
    expect(getDb().select().from(tmTickets).where(eq(tmTickets.orgId, "org_rivera")).all().map((row) => row.status)).toEqual(
      expect.arrayContaining(["draft", "ready", "verified"]),
    );
  });
});
