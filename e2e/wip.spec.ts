import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  const field = page.getByLabel("Email");
  if (!(await field.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }
  await field.fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test.describe("WIP report", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lists jobs, exports CSV, and labels schedule predecessors", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await expect(page.getByRole("link", { name: "Underbilled" }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Template bath" })).toHaveCount(0);
    await page.getByRole("link", { name: "Underbilled" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/reports\/wip\?sort=under/);
    await expect(page.getByRole("heading", { name: "WIP" })).toBeVisible();
    await expect(page.getByRole("link", { name: "WIP", exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.locator("table a").filter({ visible: true }).first()).toHaveText("Brooks powder room");
    await expect(page.getByRole("link", { name: "Okonkwo primary bath" }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chen powder room" }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Brooks family room addition" }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(wide).toBe(false);
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "wip-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "wip-dark");
    await page.emulateMedia({ colorScheme: "light" });

    await page.getByLabel("As of").filter({ visible: true }).fill("2026-09-01");
    await page.getByRole("button", { name: "Show" }).filter({ visible: true }).click();
    await expect(page.getByText("Sep 1").filter({ visible: true })).toBeVisible();

    await page.goto("/reports/wip");
    await page.getByRole("link", { name: "Brooks powder room" }).filter({ visible: true }).click();
    await expect(page.getByRole("table", { name: "Cost codes" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PLB-TOILET" })).toBeVisible();
    await page.getByLabel("Projected").fill("10000");
    await page.getByLabel("Note").fill("Owner forecast");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Override").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Owner forecast")).toBeVisible();

    await page.goto("/reports/wip");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "CSV" }).filter({ visible: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^wip-\d{4}-\d{2}-\d{2}\.csv$/);
    const file = await download.path();
    expect(file).toBeTruthy();
    const body = fs.readFileSync(file as string, "utf8");
    expect(body).toContain("Brooks powder room");
    expect(body.split("\n").at(-1)).toMatch(/^Total,/);
    await page.goto("/reports/wip/print");
    await expect(page.getByRole("heading", { name: "WIP" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Brooks powder room" })).toBeVisible();

    await page.goto("/schedule");
    await page.getByRole("button", { name: /Okonkwo primary bath Demo/ }).first().click();
    const item = page.getByRole("dialog", { name: "Schedule item" });
    await expect(item.getByLabel("Title")).toBeVisible();
    const titleInside = await item.evaluate((node) => {
      const label = [...node.querySelectorAll("label")].find((el) => el.firstChild?.textContent?.trim() === "Title");
      if (!label) return false;
      const box = label.getBoundingClientRect();
      const pane = node.getBoundingClientRect();
      return box.height > 8 && box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1;
    });
    expect(titleInside).toBe(true);
    await expect(item.getByRole("checkbox", { name: "After Tile shower" })).toBeVisible();
    await item.getByText("workdays").first().scrollIntoViewIfNeeded();
    await expect(item.getByText("Tile shower").first()).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "schedule-item-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "schedule-item-dark");
  });

  test("hides WIP from field and viewer", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await page.goto("/more");
    await expect(page.getByRole("link", { name: "WIP" })).toHaveCount(0);
    await page.goto("/reports/wip");
    await expect(page.getByRole("heading", { name: "Not in this company" })).toBeVisible();
    await signInAs(page, "riley@rivera.demo");
    await page.goto("/more");
    await expect(page.getByRole("link", { name: "WIP" })).toHaveCount(0);
    await page.goto("/reports/wip");
    await expect(page.getByRole("heading", { name: "Not in this company" })).toBeVisible();
  });
});

test.describe("WIP on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("opens underbilled jobs and a cost code", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.getByRole("link", { name: "Underbilled" }).click();
    await expect(page.getByRole("heading", { name: "WIP" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Brooks powder room" })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^wip-\d{4}-\d{2}-\d{2}\.csv$/);
    await page.getByRole("link", { name: "Brooks powder room" }).click();
    await expect(page.getByRole("cell", { name: "PLB-TOILET" })).toBeVisible();
    await page.goto("/more");
    await expect(page.getByRole("link", { name: "WIP" })).toBeVisible();
  });
});
