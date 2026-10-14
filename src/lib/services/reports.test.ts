import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile } from "@/lib/db/client";
import { authenticate } from "@/lib/services/read";
import { dashboardForRole } from "@/lib/services/dashboards";
import { library, openBuiltin, previewReport, reportCsv, saveReport } from "@/lib/services/reports";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("saved reports", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("shows custom fields the viewer can see and hides money from field", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const office = previewReport(maya, "jobs", {
      columns: ["name", "contract", "cf_job_year", "cf_job_source"],
      filters: [],
      dateColumn: "",
      from: "",
      to: "",
      sort: "name",
      dir: "asc",
      groupBy: "",
      chart: "",
      chartColumn: "",
    });
    expect(office.columns.map((column) => column.label)).toEqual(expect.arrayContaining(["Contract", "Home built year", "Lead source"]));
    const chen = office.groups[0]?.rows.find((row) => row.cells.name?.text.includes("Chen"));
    expect(chen?.cells.cf_job_year?.text).toBe("1924");
    const field = previewReport(dana, "jobs", {
      columns: ["name", "contract", "cf_job_year", "cf_job_source"],
      filters: [],
      dateColumn: "",
      from: "",
      to: "",
      sort: "name",
      dir: "asc",
      groupBy: "",
      chart: "",
      chartColumn: "",
    });
    expect(field.columns.map((column) => column.key)).toEqual(["name", "cf_job_source"]);
    expect(field.groups[0]?.rows.every((row) => row.cells.contract == null && row.cells.cf_job_year == null)).toBe(true);
    expect(() => openBuiltin(dana, "ar_aging")).toThrow(/cannot see/);
  });

  it("ages receivables, sums a group, and keeps a saved report in the company", () => {
    const maya = actor("maya@rivera.demo");
    const aging = openBuiltin(maya, "ar_aging");
    const buckets = aging.result.groups.map((group) => group.key);
    expect(buckets).toEqual(expect.arrayContaining(["Current", "30"]));
    expect(aging.result.total.balance.sum).toBeGreaterThan(0);
    const sales = openBuiltin(maya, "sales_month");
    expect(sales.result.groups.find((group) => group.key === "2026-09")?.rows).toHaveLength(1);
    expect(sales.result.grouped).toBe(true);
    expect(sales.result.chart.length).toBeGreaterThan(0);
    expect(sales.result.total.won.sum).toBeGreaterThan(0);
    expect(sales.result.total.rate.avg).toBeGreaterThan(0);
    expect(sales.result.total.rate.avg).toBeLessThanOrEqual(10000);
    const pending = openBuiltin(maya, "pending_proposals");
    expect(pending.result.groups[0]?.rows.some((row) => row.cells.title?.text.includes("Briggs"))).toBe(true);
    expect(pending.result.groups[0]?.rows[0]?.cells.age?.value).toBeGreaterThan(0);
    const id = saveReport(maya, { name: "Active jobs", source: "jobs", share: "everyone", query: pending.query });
    expect(library(maya).saved.some((report) => report.id === id)).toBe(true);
    expect(library(actor("jordan@northline.demo")).saved.some((report) => report.id === id)).toBe(false);
    expect(reportCsv(aging)).toContain("Balance");
  });

  it("puts the owner and field dashboards on the home role", () => {
    const owner = dashboardForRole(actor("maya@rivera.demo"));
    expect(owner?.tiles.map((tile) => tile.title)).toEqual(["AR 60+", "Pending proposals", "Margin this month", "Underbilled"]);
    expect(owner?.tiles[1]?.href).toContain("/reports/builtin/pending_proposals");
    const field = dashboardForRole(actor("dana@rivera.demo"));
    expect(field?.tiles.map((tile) => tile.title)).toEqual(["Today's to-dos", "Open punch items"]);
    expect(field?.tiles[0]?.rows.some((row) => row.title.includes("Okonkwo"))).toBe(true);
    expect(field?.tiles[1]?.rows.length).toBeGreaterThan(0);
  });
});
