import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("13-week cash, the cell pane, and the job overview", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/reports/cash");
  await expect(page.getByRole("heading", { name: "Cash" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Past due" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Oct \d+/ }).first()).toBeVisible();
  await expect(page.locator("[data-chart=cash]")).toBeVisible();
  await expect(page.locator("[data-cash-row=balance]")).toBeVisible();
  await expect(page.getByRole("link", { name: "CSV" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Print" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("cash-forecast.csv");
  const file = await download.path();
  expect(file).toBeTruthy();
  expect(fs.readFileSync(file ?? "", "utf8")).toContain("Past due");
  await shot(page, "cash-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "cash-dark");
  await page.emulateMedia({ colorScheme: "light" });

  const cell = page.locator("[data-cash-cell^=invoice] a").first();
  await expect(cell).toBeVisible();
  await cell.click();
  const pane = page.getByRole("dialog", { name: "Cash" });
  await expect(pane).toBeVisible();
  await expect(pane.locator("a").nth(1)).toHaveAttribute("href", /\/projects\//);
  await shot(page, "cash-pane-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "cash-pane-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await pane.getByRole("link", { name: "Close" }).click();
  await expect(pane).toHaveCount(0);

  await page.getByRole("link", { name: "Projected" }).click();
  await expect(page.getByRole("link", { name: "Projected" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-cash-row=proposal]")).toBeVisible();

  await page.goto("/projects/proj_brooks");
  await expect(page.getByRole("heading", { name: "Brooks family room addition" })).toBeVisible();
  await expect(page.locator("#punch").getByLabel("Item")).toBeHidden();
  await expect(page.getByLabel("Return")).toBeHidden();
  await expect(page.locator("#punch .mac-strip")).toHaveCount(0);
  await shot(page, "overview-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "overview-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.locator("button:visible", { hasText: "Sign out" }).click();
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await page.goto("/reports/cash");
  await expect(page.getByRole("heading", { name: "Cash" })).toHaveCount(0);
});
