import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

async function dragBar(page: Page, selector: string, dx: number) {
  const bar = page.locator(selector);
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  const x = box.x + Math.min(box.width / 2, 12);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
}

test("job gantt, critical path, drag, zoom, print, and the Today polish", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/projects/proj_brooks?view=gantt&critical=1#schedule");
  const board = page.locator("[data-gantt=job]");
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute("data-critical-on", "1");
  await expect(board).toHaveAttribute("data-zoom", "week");
  await expect(page.locator("[data-group=Framing]")).toBeVisible();
  await expect(page.locator("[data-group=Close-in]")).toBeVisible();
  await expect(page.locator("[data-held=sch_br_drywall]")).toHaveText("Held");
  await expect(page.locator("[data-today-line]")).toBeVisible();
  await expect(page.locator("[data-off]").first()).toBeVisible();
  await expect(page.locator(".gantt-base").first()).toBeVisible();
  await expect(page.locator("[data-link='sch_br_frame-sch_br_drywall']")).toHaveCount(1);
  await expect(page.locator("[data-finish]")).not.toHaveText("");
  await expect(page.locator("[data-gantt=job]").getByRole("button", { name: /^[A-Z][a-z]{2} \d/ })).toHaveCount(0);
  await expect(page.locator("[data-today-label]")).toHaveText("Today");
  await expect(page.locator("[data-gantt=job] [data-day]").first()).toHaveText(/^\d{1,2}$/);
  await expect(page.locator("[data-bar][data-critical='1']").first()).toBeVisible();
  await expect(page.locator("[data-bar][data-critical='0']").first()).toBeVisible();
  const dim = await page.locator("[data-bar][data-critical='0']").first().evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(dim)).toBeLessThan(0.5);
  const criticalBg = await page.locator("[data-bar][data-critical='1']").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const quietBg = await page.locator("[data-bar][data-critical='0']").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(criticalBg).not.toBe(quietBg);
  const jobBoard = page.locator("[data-gantt=job]");
  await page.locator("#schedule").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(page.locator("[data-bar=sch_br_frame]")).toBeInViewport();
  const jobChart = page.locator("[data-gantt=job] [data-gantt-chart]");
  const jobChartBox = await jobChart.boundingBox();
  const jobBoardBox = await jobBoard.boundingBox();
  expect(jobBoardBox && jobBoardBox.width).toBeGreaterThan(900);
  expect(jobChartBox && jobBoardBox && jobChartBox.width).toBeGreaterThan((jobBoardBox?.width ?? 0) * 0.45);
  await expect(page.locator(".mac-inspector")).toBeHidden();
  await expect(page.getByLabel("Exception date")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Inspections" })).toHaveCount(0);
  const clipped = await page.locator(".gantt-name", { hasText: "Window delivery" }).evaluate((el) => {
    const cell = el.closest("td");
    return !cell || el.scrollWidth > cell.clientWidth + 2;
  });
  expect(clipped).toBe(false);
  await page.screenshot({ path: "/opt/cursor/artifacts/gantt-job-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/opt/cursor/artifacts/gantt-job-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Critical" }).click();
  await expect(board).toHaveAttribute("data-critical-on", "0");
  await page.getByRole("button", { name: "Critical" }).click();
  await expect(board).toHaveAttribute("data-critical-on", "1");

  await page.goto("/schedule/items/sch_br_frame");
  await expect(page.locator("[data-float]")).toContainText("wd");
  await page.goto("/projects/proj_brooks?view=gantt&critical=1#schedule");

  const dayPx = Number(await page.locator("[data-gantt=job]").getAttribute("data-day-width"));
  await dragBar(page, "[data-bar=sch_br_frame]", dayPx * 8);
  const delay = page.getByRole("dialog", { name: "Delay" });
  await expect(delay).toBeVisible();
  await expect(delay).toContainText(/Moves \d+ items/);
  await delay.getByRole("button", { name: "Cancel" }).click();
  await expect(delay).toHaveCount(0);
  await expect(page.locator("[data-bar=sch_br_frame]")).toHaveAttribute("data-start", /\d{4}-\d{2}-\d{2}/);

  await dragBar(page, "[data-bar=sch_br_drywall]", -dayPx);
  const gate = page.locator("span.inline-flex", { hasText: "has not passed" });
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("has not passed")).toHaveCount(0);

  const frame = page.locator("[data-bar=sch_br_frame]");
  await frame.focus();
  await frame.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Delay" })).toBeVisible();
  await page.getByRole("dialog", { name: "Delay" }).getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page.locator("[data-gantt=job]")).toHaveAttribute("data-zoom", "month");
  const jobPrint = page.locator("#schedule").getByRole("link", { name: "Print" });
  await expect(jobPrint).toHaveAttribute("href", /zoom=month/);
  await jobPrint.click();
  await expect(page).toHaveURL(/\/projects\/proj_brooks\/schedule\/print\?zoom=month/);
  await expect(page.locator("[data-gantt=job]")).toHaveAttribute("data-zoom", "month");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();

  await page.goto("/schedule?view=gantt&critical=1");
  await expect(page.locator("[data-gantt=org]")).toBeVisible();
  await expect(page.locator("[data-expand=proj_brooks]")).toBeVisible();
  await page.locator("[data-expand=proj_brooks]").click();
  await expect(page.getByRole("link", { name: "Framing walk" })).toBeVisible();
  await expect(page.locator("[data-gantt=org]")).toHaveAttribute("data-critical-on", "1");
  const orgChart = page.locator("[data-gantt-chart]");
  const orgBox = await orgChart.boundingBox();
  expect(orgBox && orgBox.width).toBeGreaterThan(480);
  await page.locator("[data-gantt=org]").screenshot({ path: "/opt/cursor/artifacts/gantt-org-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("[data-gantt=org]").screenshot({ path: "/opt/cursor/artifacts/gantt-org-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("link", { name: "Quarter", exact: true }).click();
  await expect(page.locator("[data-gantt=org]")).toHaveAttribute("data-zoom", "quarter");
  await expect(page.locator("[data-gantt=org]").getByRole("link", { name: "Print" })).toHaveAttribute("href", /zoom=quarter/);

  await page.locator("button:visible", { hasText: "Sign out" }).click();
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await page.goto("/projects/proj_brooks?view=gantt#schedule");
  await expect(page.locator("[data-gantt=job]")).toBeVisible();
  await expect(page.locator("[data-resize]")).toHaveCount(0);
  await expect(page.locator("[data-bar=sch_br_frame]")).toBeDisabled();

  await page.locator("button:visible", { hasText: "Sign out" }).click();
  await signIn(page);
  const kpis = page.locator("[data-today-kpis]:visible");
  await expect(kpis.getByText("Pending proposals")).toBeVisible();
  await expect(kpis.getByText("Pipeline")).toBeVisible();
  await expect(kpis.getByText("AR 60+")).toBeVisible();
  await expect(page.locator("details[data-today-more]:visible")).toBeVisible();
  await expect(page.locator("a:visible", { hasText: "Client updates" })).toBeVisible();
  await expect(page.locator("a:visible", { hasText: "Schedule slip" })).toHaveCount(0);
  const labelOffset = async (name: string) =>
    page.locator("[data-today-kpis]:visible").getByText(name, { exact: true }).first().evaluate((node) => {
      const tile = node.closest("a, div");
      if (!tile) return -1;
      return Math.round(node.getBoundingClientRect().top - tile.getBoundingClientRect().top);
    });
  expect(await labelOffset("Pipeline")).toBe(await labelOffset("AR 60+"));
  expect(await labelOffset("To collect")).toBe(await labelOffset("Pending proposals"));
  const pins = page.locator("nav a[aria-label='Pin']:visible");
  const gap = await pins.first().evaluate((el) => getComputedStyle(el.parentElement!).rowGap);
  expect(gap).toBe("6px");
  await shot(page, "today-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "today-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await revealToday(page, "Schedule slip");
  await expect(page.locator("a:visible", { hasText: "Schedule slip" })).toContainText("1");

  await page.goto("/reports/builtin/sales_month");
  await expect(page.locator("[data-group='2026-07']")).toContainText("Jul 2026 · 1");
  await expect(page.locator("[data-group='2026-07']")).not.toContainText("2026-07");
  await expect(page.locator("[data-subtotal='2026-07'] td").nth(0)).toHaveText("");
  await expect(page.locator("[data-subtotal='2026-07'] td").nth(1)).toContainText("$");
  await expect(page.locator("[data-subtotal='2026-07'] td").nth(2)).toHaveText("");
  const chart = page.locator("[data-chart=bar]");
  await expect(chart).toHaveCSS("height", "64px");
  const barWidth = await chart.locator(".rounded-sm").first().evaluate((el) => el.getBoundingClientRect().width);
  expect(barWidth).toBeLessThan(12);
  await expect(chart).toContainText("Jul 2026");
  await shot(page, "reports-grouped-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "reports-grouped-dark");
});
