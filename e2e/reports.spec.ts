import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
}

test("builds a report, exports csv, and opens a role dashboard", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/reports");
  const list = page.locator("[data-mac-list]");
  await expect(list.getByRole("link", { name: "Pending proposals" })).toBeVisible();
  await expect(list.getByRole("link", { name: "WIP", exact: true })).toBeVisible();
  await expect(list.getByRole("link", { name: "Variance", exact: true })).toBeVisible();
  await shot(page, "reports-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "reports-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("link", { name: "New", exact: true }).click();
  await page.locator("a[href='/reports/new?source=jobs']").click();
  await page.getByLabel("Home built year").check();
  await page.locator("select[aria-label='Filter 1']").selectOption("status");
  await page.getByLabel("Value 1").fill("active");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.locator("[data-mac-list]").getByRole("link", { name: "Chen powder room" })).toBeVisible();
  await shot(page, "reports-builder-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "reports-builder-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Report name").fill("Active jobs");
  await page.getByLabel("Share").selectOption("everyone");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Active jobs" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Home built year" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
  const csv = fs.readFileSync(await download.path(), "utf8");
  expect(csv).toContain("Home built year");
  expect(csv).toContain("Chen powder room");
  expect(csv).not.toContain("Diaz deck");

  await page.goto("/reports/builtin/sales_month");
  await expect(page.locator("[data-chart=bar]")).toBeVisible();
  await expect(page.locator("[data-group='2026-09']")).toContainText("Sep 2026 · 1");
  await expect(page.locator("[data-subtotal='2026-09'] td").nth(0)).toHaveText("");
  await expect(page.locator("[data-subtotal='2026-09'] td").nth(2)).toHaveText("");
  await expect(page.locator("[data-subtotal]").first()).toBeVisible();
  await expect(page.locator("[data-total]")).toBeVisible();
  await shot(page, "reports-grouped-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "reports-grouped-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  const kpis = page.locator("[data-today-kpis]:visible");
  await expect(kpis.getByText("Pending proposals")).toBeVisible();
  await expect(kpis.getByText("Pipeline")).toBeVisible();
  await expect(page.locator("details[data-today-more]:visible")).toBeVisible();
  const board = page.locator("[data-dashboard=Owner]:visible");
  await expect(board.getByText("Pending proposals")).toBeVisible();
  await expect(board.getByText("AR 60+")).toBeVisible();
  await expect(board.getByText("Underbilled")).toBeVisible();
  await shot(page, "reports-today-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "reports-today-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await board.locator("[data-tile='Pending proposals']").click();
  await expect(page.getByRole("heading", { name: "Pending proposals" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Briggs/ })).toBeVisible();
});
