import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EIO") throw error;
    return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
  });
}

async function pair(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, name);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, `${name}-dark`);
  await page.emulateMedia({ colorScheme: "light" });
}

test("add a source, set spend, tag a lead, and read the report", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/settings/lead-sources");
  await expect(page.getByRole("heading", { name: "Lead sources" })).toBeVisible();
  for (const name of ["Website form", "Referral", "Google", "Repeat client", "Yard sign", "Other"]) {
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByLabel("Source name").fill("Nextdoor");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status").last()).toContainText("Added");
  await expect(page.getByRole("row", { name: /Nextdoor/ })).toBeVisible();
  await page.getByLabel("Nextdoor spend").fill("100");
  await page.getByRole("button", { name: "Save Nextdoor" }).click();
  await expect(page.getByLabel("Nextdoor spend")).toHaveValue("100");
  await pair(page, "lead-sources-settings");

  await page.goto("/leads/new");
  await page.getByLabel("Source").selectOption({ label: "Nextdoor" });
  await page.getByLabel("Scope").fill("Nextdoor neighbor, 12 sq ft powder room. Budget $4,000.");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel("Lead source")).toHaveValue(/.+/);
  await expect(page.locator(".fl-pill", { hasText: "Nextdoor" })).toBeVisible();

  await page.goto("/reports/builtin/lead_sources");
  await expect(page.getByRole("heading", { name: "Lead sources" })).toBeVisible();
  const row = page.getByRole("row", { name: /Nextdoor/ });
  await expect(row).toContainText("1");
  await expect(row).toContainText("$100");
  await expect(row).toContainText("—");
  await expect(page.getByRole("row", { name: /Total/ })).toBeVisible();
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/report?id=lead_sources");
    return response.text();
  });
  expect(csv).toContain("Nextdoor");
  expect(csv).toContain("Total");
  expect(csv).not.toContain("NaN");
  expect(csv).not.toContain("Infinity");
  await pair(page, "lead-sources-report");
});
