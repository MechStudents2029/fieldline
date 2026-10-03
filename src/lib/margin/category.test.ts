import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessCategories, CATEGORY_WATCH_BPS, rollupCostCodes } from "@/lib/margin/category";
import { useDatabaseFile } from "@/lib/db/client";
import { askCopilot, listCategoryAlerts, projectDetail } from "@/lib/services/read";
import { authenticate } from "@/lib/services/read";
import { createChangeOrder } from "@/lib/services/write";

describe("category budget alerts", () => {
  it("warns at 80% and flags spend past the budget", () => {
    expect(CATEGORY_WATCH_BPS).toBe(8000);
    const rows = assessCategories([
      { code: "TILE-BACK", budgetCents: 10_000, actualCents: 8_000 },
      { code: "FRM-WALL", budgetCents: 10_000, actualCents: 7_999 },
      { code: "ROOF-ARCH", budgetCents: 10_000, actualCents: 12_200 },
      { code: "ZERO", budgetCents: 0, actualCents: 5_000 },
    ]);
    expect(rows.find((row) => row.code === "TILE-BACK")).toMatchObject({
      level: "watch",
      percentOfBudget: 80,
      overageCents: 0,
      suggestDraft: false,
    });
    expect(rows.find((row) => row.code === "FRM-WALL")?.level).toBe("ok");
    expect(rows.find((row) => row.code === "ROOF-ARCH")).toMatchObject({
      level: "over",
      percentOfBudget: 122,
      overageCents: 2_200,
      suggestDraft: true,
      draftCostCents: 2_200,
    });
    expect(rows.find((row) => row.code === "ZERO")?.level).toBe("ok");
  });

  it("rolls uncoded costs into one bucket and suggests a draft only when uncovered", () => {
    const rolled = rollupCostCodes(
      [{ costCode: "TILE-BACK", budgetCostCents: 10_000 }],
      [
        { costCode: null, amountCents: 400 },
        { costCode: "  ", amountCents: 100 },
        { costCode: "TILE-BACK", amountCents: 15_000 },
      ],
    );
    expect(rolled.find((row) => row.code === "Uncoded")?.actualCents).toBe(500);
    const uncovered = assessCategories(rolled, []);
    expect(uncovered.find((row) => row.code === "TILE-BACK")?.suggestDraft).toBe(true);

    const covered = assessCategories(rolled, [{ status: "sent", costCode: "TILE-BACK", costCents: 5_000 }]);
    expect(covered.find((row) => row.code === "TILE-BACK")).toMatchObject({
      level: "over",
      covered: true,
      suggestDraft: false,
      draftCostCents: 0,
    });

    const partial = assessCategories(rolled, [{ status: "draft", costCode: "TILE-BACK", costCents: 2_000 }]);
    expect(partial.find((row) => row.code === "TILE-BACK")).toMatchObject({ suggestDraft: true, draftCostCents: 3_000 });

    const declined = assessCategories(rolled, [{ status: "declined", costCode: "TILE-BACK", costCents: 9_000 }]);
    expect(declined.find((row) => row.code === "TILE-BACK")?.suggestDraft).toBe(true);

    const approved = assessCategories(
      [{ code: "TILE-BACK", budgetCents: 10_000, actualCents: 15_000 }],
      [{ status: "approved", costCode: "TILE-BACK", costCents: 5_000 }],
    );
    expect(approved[0]).toMatchObject({ covered: true, suggestDraft: false });
  });
});

describe("seeded jobs", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  afterAll(() => {
    useDatabaseFile(":memory:");
  });

  it("flags Brooks roof as an uncovered draft and framing as an 80% watch", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const detail = projectDetail(maya.orgId, "proj_brooks", "owner");
    const roof = detail?.financials?.byCode.find((row) => row.code === "ROOF-ARCH");
    const framing = detail?.financials?.byCode.find((row) => row.code === "FRM-WALL");
    expect(roof).toMatchObject({ level: "over", suggestDraft: true });
    expect(roof!.actualCents).toBeGreaterThan(roof!.budgetCents);
    expect(framing).toMatchObject({ level: "watch", suggestDraft: false });
    expect(framing!.percentOfBudget).toBeGreaterThanOrEqual(80);

    const alerts = listCategoryAlerts(maya.orgId);
    expect(alerts.some((row) => row.projectId === "proj_brooks" && row.code === "ROOF-ARCH" && row.suggestDraft)).toBe(true);
    expect(alerts.some((row) => row.projectId === "proj_diaz")).toBe(false);

    const answer = askCopilot(maya.orgId, "Which cost codes are over budget?");
    expect(answer.tool).toBe("job_margins");
    expect(answer.answer).toMatch(/ROOF-ARCH/);
    expect(answer.rows.some((row) => row.label.includes("ROOF-ARCH"))).toBe(true);

    createChangeOrder(maya, "proj_brooks", {
      title: "Roof tie-in overage",
      description: "Cover the roof code.",
      name: "Roof tie-in",
      qty: 1,
      unit: "ea",
      unitCostCents: roof!.draftCostCents,
      markupBps: 3500,
      costCode: "ROOF-ARCH",
    });
    const after = projectDetail(maya.orgId, "proj_brooks", "owner");
    expect(after?.financials?.byCode.find((row) => row.code === "ROOF-ARCH")).toMatchObject({
      level: "over",
      covered: true,
      suggestDraft: false,
    });
    expect(after?.orders.some((order) => order.status === "draft" && order.title === "Roof tie-in overage")).toBe(true);
  });
});
