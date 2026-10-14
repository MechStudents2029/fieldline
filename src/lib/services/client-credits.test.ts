import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { costItems, invoices, payments, projects, tasks } from "@/lib/db/schema";
import { CLIENT_CREDIT_METHOD } from "@/lib/credits/client-memo";
import { listInbox, openNotification } from "@/lib/services/comments";
import {
  applyClientCredit,
  clientCreditAttention,
  clientCreditCsv,
  clientOpenCredit,
  createClientCredit,
  jobClientCredits,
  jobContractCents,
  listClientCredits,
  portalClientCredits,
  releaseClientCredit,
  voidClientCredit,
} from "@/lib/services/client-credits";
import { parseTrigger, saveAutomation, triggerLabel } from "@/lib/services/automations";
import { authenticate, portalByToken } from "@/lib/services/read";
import { portalMoney } from "@/lib/portal/summary";
import { ServiceError } from "@/lib/services/errors";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("client credit memos", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds an open memo and a partial memo without touching the contract or Diaz", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const rows = listClientCredits(maya);
    expect(rows.map((row) => row.number)).toEqual(["CM-1049", "CM-1048"]);
    expect(rows.find((row) => row.number === "CM-1048")).toMatchObject({ status: "ready", amountCents: 18_000, remainingCents: 18_000 });
    expect(rows.find((row) => row.number === "CM-1049")).toMatchObject({ status: "partial", amountCents: 30_000, appliedCents: 8_000, remainingCents: 22_000 });
    expect(listClientCredits(dana).some((row) => row.number === "CM-1048")).toBe(false);
    expect(clientOpenCredit("org_rivera", "c_brooks")).toEqual({ count: 2, cents: 40_000 });
    expect(jobClientCredits("org_rivera", "proj_brooks")).toMatchObject({ openCents: 40_000, appliedCents: 8_000 });
    expect(clientCreditAttention("org_rivera", "owner").count).toBe(2);
    expect(clientCreditAttention("org_rivera", "field").count).toBe(0);
    expect(clientCreditCsv(maya)).toContain("CM-1048");
    expect(clientCreditCsv(dana)).toBeNull();
    const invoice = getDb().select().from(invoices).where(eq(invoices.id, "inv_br_prog")).get();
    expect(invoice).toMatchObject({ status: "open", amountPaidCents: 8_000 });
    const payment = getDb().select().from(payments).where(eq(payments.id, "pay_ccm_trim")).get();
    expect(payment).toMatchObject({ method: CLIENT_CREDIT_METHOD, amountCents: 8_000, netCents: 0, status: "succeeded" });
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_dz_final")).get()?.amountPaidCents).toBe(0);
    const portal = portalByToken("demo_portal_brooks");
    const money = portalMoney({
      proposalStatus: portal?.proposal?.status ?? null,
      proposalTotalCents: portal?.proposal?.totalCents ?? null,
      orders: portal?.orders ?? [],
      payments: portal?.payments ?? [],
    });
    expect(money.creditCents).toBe(8_000);
    expect(money.contractCents).toBeGreaterThan(0);
    expect(portalClientCredits("demo_portal_brooks").map((row) => row.number)).toEqual(["CM-1048", "CM-1049"]);
    const inbox = listInbox(maya, "unread");
    const note = inbox.find((row) => row.snippet === "CM-1048");
    expect(note?.kind).toBe("client_credit");
    expect(openNotification(maya, note!.id)).toBe("/credit-memos/ccm_open");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "client_credit_created" }))!)).toBe("Client credit memo created");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "client_credit_applied" }))!)).toBe("Client credit memo applied");
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "client_credit_voided" }))!)).toBe("Client credit memo voided");
  });

  it("applies part of a memo once, refuses the rest, and voiding restores the invoice without cash", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const contract = jobContractCents("org_rivera", "proj_chen");
    const costs = getDb().select().from(costItems).where(eq(costItems.projectId, "proj_chen")).all().length;
    const draft = createClientCredit(dana, { projectId: "proj_chen", title: "Paint touch-up", description: "Hall", kind: "flat" });
    expect(draft).toMatchObject({ status: "draft", amountCents: 0 });
    expect(() => releaseClientCredit(dana, draft.id, { amountCents: 1_000 })).toThrow(ServiceError);
    expect(() => applyClientCredit(dana, { memoId: "ccm_open", invoiceId: "inv_br_prog", amountCents: 1_000, idempotencyKey: "field-apply-01" })).toThrow(ServiceError);
    expect(() => voidClientCredit(dana, "ccm_open", "No")).toThrow(ServiceError);
    expect(() => createClientCredit(riley, { projectId: "proj_chen", title: "Nope", kind: "flat", amountCents: 100 })).toThrow(ServiceError);
    expect(() => createClientCredit(dana, { projectId: "proj_chen", title: "Priced", kind: "flat", amountCents: 100 })).toThrow(/amount/);

    const memo = createClientCredit(maya, {
      projectId: "proj_chen",
      title: "Owner allowance",
      description: "Left from the allowance",
      kind: "lines",
      lines: [
        { costCode: "PNT-WALL", description: "Wall paint", amountCents: 4_000 },
        { costCode: "PNT-TRIM", description: "Trim paint", amountCents: 6_000 },
      ],
      release: true,
    });
    expect(memo).toMatchObject({ status: "ready", amountCents: 10_000 });
    expect(jobContractCents("org_rivera", "proj_chen")).toBe(contract);
    const first = applyClientCredit(maya, { memoId: memo.id, invoiceId: "inv_chen_dep", amountCents: 4_000, idempotencyKey: "chen-allow-01" });
    expect(first.duplicate).toBe(false);
    const again = applyClientCredit(maya, { memoId: memo.id, invoiceId: "inv_chen_dep", amountCents: 4_000, idempotencyKey: "chen-allow-01" });
    expect(again.duplicate).toBe(true);
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_chen_dep")).get()?.amountPaidCents).toBe(4_000);
    expect(() => applyClientCredit(maya, { memoId: memo.id, invoiceId: "inv_chen_dep", amountCents: 7_000, idempotencyKey: "chen-allow-02" })).toThrow(/memo left/);
    expect(getDb().select().from(payments).where(eq(payments.invoiceId, "inv_chen_dep")).all().every((row) => row.method !== CLIENT_CREDIT_METHOD || row.netCents === 0)).toBe(true);
    const second = applyClientCredit(maya, { memoId: memo.id, invoiceId: "inv_chen_dep", amountCents: 6_000, idempotencyKey: "chen-allow-03" });
    expect(second.memoStatus).toBe("applied");
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_chen_dep")).get()).toMatchObject({ status: "open", amountPaidCents: 10_000 });
    voidClientCredit(maya, memo.id, "Client kept the allowance");
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_chen_dep")).get()).toMatchObject({ status: "open", amountPaidCents: 0 });
    expect(() => voidClientCredit(maya, memo.id, "Again")).toThrow(/already void/);
    expect(getDb().select().from(invoices).where(eq(invoices.id, "inv_chen_dep")).get()?.amountPaidCents).toBe(0);
    expect(() => applyClientCredit(maya, { memoId: memo.id, invoiceId: "inv_chen_dep", amountCents: 1_000, idempotencyKey: "chen-allow-04" })).toThrow(/Release/);
    expect(jobContractCents("org_rivera", "proj_chen")).toBe(contract);
    expect(getDb().select().from(costItems).where(eq(costItems.projectId, "proj_chen")).all()).toHaveLength(costs);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_diaz")).get()?.contractValueCents).toBeTypeOf("number");
  });

  it("runs an automation when a memo is created", () => {
    const maya = actor("maya@rivera.demo");
    saveAutomation(maya, {
      name: "Credit memo created",
      enabled: true,
      trigger: { kind: "client_credit_created" },
      conditions: [],
      actions: [{ kind: "todo", title: "Review the owner credit", who: "", dueDays: 0 }],
    });
    createClientCredit(maya, { projectId: "proj_chen", title: "Hardware credit", description: "Hinge", kind: "flat", amountCents: 2_500 });
    expect(getDb().select().from(tasks).all().some((row) => row.title === "Review the owner credit")).toBe(true);
  });
});
