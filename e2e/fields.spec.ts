import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("custom fields on settings, a job, and the jobs list", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/settings/fields");
  await expect(page.getByRole("heading", { name: "Custom fields" })).toBeVisible();
  await expect(page.getByText("Lead source")).toBeVisible();
  await expect(page.getByText("Gate code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Up" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reorder Lead source" })).toBeVisible();
  await expect(page.locator("[data-fields=job] .fl-pill", { hasText: "Office" }).first()).toBeVisible();
  await expect(page.locator("[data-fields=job] .fl-pill", { hasText: "Field" }).first()).toBeVisible();
  const widths = await page.locator("table.fields-table").evaluateAll((tables) =>
    tables.map((table) => [...table.querySelectorAll("col")].map((col) => (col as HTMLElement).style.width).join("|")),
  );
  expect(widths.length).toBeGreaterThan(1);
  expect(new Set(widths).size).toBe(1);
  await page.getByLabel("Actions for Preferred").click();
  await expect(page.getByRole("button", { name: "Archive Preferred" })).toBeVisible();
  await shot(page, "fields-settings-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "fields-settings-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_chen");
  await expect(page.getByText("Referral")).toBeVisible();
  await expect(page.getByText("Permit required")).toBeVisible();
  await shot(page, "fields-job-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "fields-job-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects");
  await page.getByRole("button", { name: "Saved views" }).click();
  await page.getByRole("link", { name: "Lead source" }).click();
  await expect(page.getByRole("columnheader", { name: "Lead source" })).toBeVisible();
  await page.locator("select[aria-label='Lead source']").locator("visible=true").selectOption("Referral");
  await expect(page.locator("[data-mac-list]").getByRole("link", { name: "Chen powder room" })).toBeVisible();
  await expect(page.locator("[data-mac-list]").getByRole("link", { name: "Brooks family room addition" })).toHaveCount(0);
  await page.getByRole("columnheader", { name: "Lead source" }).scrollIntoViewIfNeeded();
  await shot(page, "fields-jobs-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "fields-jobs-dark");
});
