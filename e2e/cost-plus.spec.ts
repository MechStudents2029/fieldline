import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("bill cost-plus costs and show the invoice on the portal", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);
  await expect(page.getByRole("link", { name: /Unbilled costs/ })).toContainText("1");

  await page.goto("/projects/proj_ellis/costs");
  await expect(page.getByRole("heading", { name: "Costs" })).toBeVisible();
  await expect(page.getByText("Cabinet note stays internal")).toHaveCount(0);
  await expect(page.getByText("Valve note stays internal")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Cabinet boxes/ })).toContainText("Unbilled");
  await expect(page.getByRole("row", { name: /Supply lines/ })).toContainText("RR-1070");
  await expect(page.getByRole("row", { name: /Shop scraps/ })).toContainText("Non-billable");
  await shot(page, "cost-plus-picker-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "cost-plus-picker-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByLabel("Lines").selectOption("grouped");
  await page.getByLabel("Markup display").selectOption("separate");
  await page.getByRole("checkbox", { name: "Mill & Co Cabinets · MC-19 · Cabinet boxes" }).check();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByRole("table", { name: "Invoice" })).toBeVisible();
  await expect(page.getByRole("row", { name: "Markup" })).toBeVisible();
  await expect(page.getByText("Cabinet note stays internal")).toHaveCount(0);
  await shot(page, "cost-plus-invoice-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "cost-plus-invoice-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "Open" })).toHaveCount(0);
  await expect(page.locator(".fl-pill")).toHaveText("Open");
  await page.goto("/portal/demo_portal_ellis");
  await expect(page.getByText("Markup")).toBeVisible();
  await expect(page.getByText("Cabinets")).toBeVisible();
  await expect(page.getByText("stays internal")).toHaveCount(0);
  await expect(page.getByText("private note")).toHaveCount(0);
});
