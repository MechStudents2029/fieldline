import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: false });
}

test("sell a maintenance agreement through a draft invoice and a renewal", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/agreements/new");
  await page.getByLabel("Client").selectOption({ label: "Amara Okonkwo" });
  await page.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
  await page.getByLabel("Name").fill("Filter plan e2e");
  await page.getByLabel("Start").fill("2026-10-13");
  await page.getByLabel("Term").selectOption("visits");
  await page.getByLabel("Visits").fill("2");
  await page.getByLabel("Cadence").selectOption("weekly");
  await page.getByLabel("Billing").selectOption("per_visit");
  await page.getByLabel("Code").selectOption("FRM-LABOR");
  await page.getByLabel("Qty").fill("1");
  await page.getByLabel("Checklist").fill("Replace filter");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Filter plan e2e" })).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".fl-pill", { hasText: "Active" })).toBeVisible();
  await page.goto("/schedule?on=2026-10-13");
  await expect(page.getByText("Filter plan e2e").first()).toBeVisible();
  await page.goto("/agreements");
  await page.getByRole("link", { name: "Filter plan e2e" }).click();
  await page.getByRole("checkbox", { name: "Replace filter" }).first().check();
  await page.getByRole("button", { name: "Complete" }).first().click();
  await expect(page.getByText(/Draft SA-/)).toBeVisible();
  await shot(page, "agreements-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "agreements-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Renew" }).click();
  await expect(page.getByRole("heading", { name: "Filter plan e2e" })).toBeVisible();
  await expect(page.locator(".fl-pill", { hasText: "Draft" })).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".fl-pill", { hasText: "Active" })).toBeVisible();
  await page.getByRole("link", { name: "Filter plan e2e" }).first().click();
  await expect(page.locator(".fl-pill", { hasText: "Renewed" })).toBeVisible();
});
