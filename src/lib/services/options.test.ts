import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, budgetLines, invoices, projects, proposals } from "@/lib/db/schema";
import { formatWhole } from "@/lib/money";
import { authenticate, estimateDetail } from "@/lib/services/read";
import { openBuiltin } from "@/lib/services/reports";
import { chooseProposalOption, duplicateOption, enableOptions, sendProposal, signProposal, switchProposalOption, syncEstimateGrid } from "@/lib/services/write";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("proposal option records", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps a single-scope estimate and reports the chosen tier", () => {
    const maya = actor("maya@rivera.demo");
    expect(formatWhole(estimateDetail(maya.orgId, "est_vasquez")!.priceCents)).toBe("$68,671");
    expect(estimateDetail(maya.orgId, "est_vasquez")!.options).toEqual([]);
    const tiers = openBuiltin(maya, "option_tiers");
    const rows = tiers.result.groups[0]?.rows ?? [];
    expect(rows.find((row) => row.cells.set?.text === "Better")?.cells.wins?.text).toBe("1");
    expect(rows.find((row) => row.cells.set?.text === "Better")?.cells.share?.text).toBe("100%");
    expect(rows.find((row) => row.cells.set?.text === "With options")?.cells.amount?.text).toBe("$13,500");
    expect(rows.find((row) => row.cells.set?.text === "Without options")?.cells.amount?.text).toMatch(/^\$/);

    enableOptions(maya, "est_vasquez");
    const detail = estimateDetail(maya.orgId, "est_vasquez")!;
    expect(detail.options.map((option) => option.name)).toEqual(["Good", "Better"]);
    expect(formatWhole(detail.priceCents)).toBe("$68,671");
    const better = detail.options[1]!;
    duplicateOption(maya, better.id);
    duplicateOption(maya, better.id);
    expect(() => duplicateOption(maya, better.id)).toThrow(/2 to 4/);
  });

  it("signs the chosen option and refuses a switch after the deposit", async () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    syncEstimateGrid(maya, {
      estimateId: "est_cho",
      optionId: "opt_cho_good",
      lines: [
        {
          id: "li_cho_good",
          sectionId: "sec_cho",
          name: "Acrylic base",
          qty: 2,
          unit: "ea",
          unitCostCents: 400_000,
          markupBps: 5000,
          billing: "included",
          costCode: "BATH-BASE",
          sortOrder: 0,
        },
      ],
      deletedIds: [],
    });
    expect(estimateDetail(maya.orgId, "est_cho")!.lines.find((line) => line.id === "li_cho_better")!.qtyMilli).toBe(1000);

    const sent = await sendProposal(maya, "est_cho");
    expect(() =>
      syncEstimateGrid(maya, {
        estimateId: "est_cho",
        optionId: "opt_cho_better",
        lines: [],
        deletedIds: [],
      }),
    ).toThrow(/already sent/);
    const frozen = JSON.parse(db.select().from(proposals).where(eq(proposals.id, sent.proposalId)).get()!.snapshotJson) as {
      options: { name: string; public: { totalCents: number } }[];
    };
    expect(frozen.options.find((option) => option.name === "Better")?.public.totalCents).toBe(1_350_000);

    chooseProposalOption(sent.publicToken, "opt_cho_better");
    expect(() => chooseProposalOption(sent.publicToken, "opt_cho_best")).toThrow(/already chosen/);
    const chosen = JSON.parse(db.select().from(proposals).where(eq(proposals.id, sent.proposalId)).get()!.snapshotJson) as {
      options: { name: string; status: string }[];
      public: { totalCents: number };
    };
    expect(chosen.options.map((option) => option.status)).toEqual(["declined", "chosen", "declined"]);
    expect(chosen.public.totalCents).toBe(1_350_000);

    const signed = signProposal({ token: sent.publicToken, signerName: "Helen Cho", typedName: "Helen Cho", consent: true });
    expect(signed.totalCents).toBe(1_350_000);
    expect(db.select().from(projects).where(eq(projects.id, signed.projectId)).get()?.contractValueCents).toBe(1_350_000);
    expect(db.select().from(budgetLines).where(eq(budgetLines.projectId, signed.projectId)).all().map((line) => line.name).sort()).toEqual(["Fixture allowance", "Tile shower"]);

    switchProposalOption(maya, sent.proposalId, "opt_cho_best", "Glass instead");
    expect(db.select().from(projects).where(eq(projects.id, signed.projectId)).get()?.contractValueCents).toBe(2_100_000);
    expect(db.select().from(budgetLines).where(eq(budgetLines.projectId, signed.projectId)).all().map((line) => line.name)).toEqual(["Tile shower and glass"]);
    const audit = db.select().from(auditLogs).where(eq(auditLogs.action, "proposal.option")).all().at(-1);
    expect(JSON.parse(audit?.payloadJson || "{}")).toMatchObject({ reason: "Glass instead", optionId: "opt_cho_best" });

    db.update(invoices).set({ amountPaidCents: 100 }).where(eq(invoices.projectId, signed.projectId)).run();
    expect(() => switchProposalOption(maya, sent.proposalId, "opt_cho_good", "Too late")).toThrow(/deposit is already paid/);
    expect(db.select().from(projects).where(eq(projects.id, signed.projectId)).get()?.contractValueCents).toBe(2_100_000);
  });
});
