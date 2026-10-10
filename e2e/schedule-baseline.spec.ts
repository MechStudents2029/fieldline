import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("baseline, a delay reason, and the variance report", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);
  await expect(page.getByRole("link", { name: /Schedule slip/ })).toContainText("1");

  await page.goto("/schedule?span=14");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.locator("th.is-off", { hasText: "Mon 12" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Window delivery/ })).toContainText(/\+\d+ wd/);
  await shot(page, "schedule-baseline-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "schedule-baseline-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_brooks");
  await page.getByRole("button", { name: "Set baseline" }).click();
  await expect(page.locator("#schedule")).toContainText("0 wd");

  await page.goto("/schedule?span=14");
  const chip = page.getByRole("button", { name: /Brooks family room addition Window delivery/ });
  await chip.dragTo(page.getByRole("button", { name: "Add Dana Cho 2026-10-16" }));
  const delay = page.getByRole("dialog", { name: "Delay" });
  await expect(delay).toBeVisible();
  await shot(page, "schedule-delay-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "schedule-delay-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await delay.getByLabel("Reason").selectOption("weather");
  await delay.getByRole("button", { name: "Save" }).click();
  await expect(delay).toHaveCount(0);

  await page.goto("/reports/schedule");
  await expect(page.getByRole("heading", { name: "Schedule variance" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Brooks family room addition" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Brooks family room addition/ })).toContainText("+1 wd");
  await shot(page, "schedule-variance-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "schedule-variance-dark");
});
