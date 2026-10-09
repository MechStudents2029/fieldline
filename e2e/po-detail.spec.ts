import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test("purchase order detail, edit, and a bill from the order", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/purchase-orders/po_ok_retain");
  await expect(page.getByRole("heading", { level: 1, name: "PO-1055" })).toBeVisible();
  await expect(page.locator("[data-status='issued']")).toBeVisible();
  await expect(page.getByLabel("Scope")).toHaveCount(0);
  const shower = page.getByRole("row", { name: /PLB-SHOWER/ });
  await expect(shower.locator("[data-kind='billed']")).toHaveText("$3,000.00");
  await expect(shower.locator("[data-kind='remaining']")).toHaveText("$2,000.00");
  await expect(page.getByRole("table", { name: "Bills" })).toContainText("HP-510");
  await expect(page.getByRole("table", { name: "Bills" })).toContainText("HP-511");
  await shot(page, "po-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "po-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Scope")).toBeVisible();
  await expect(page.getByText("Saving keeps")).toHaveCount(0);
  await shot(page, "po-edit-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "po-edit-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Scope")).toHaveCount(0);

  await page.getByRole("button", { name: "New bill" }).click();
  await expect(page.getByLabel("Line 1 amount")).toHaveValue("2000.00");
  await expect(page.locator("[data-bill-net]")).toContainText("10%");
  await expect(page.locator("[data-bill-net]")).toContainText("Net $1,800.00");
  await page.getByLabel("Line 1 amount").fill("2500.00");
  await expect(page.getByText("over on PLB-SHOWER")).toBeVisible();
  await shot(page, "po-bill-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "po-bill-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Line 1 amount").fill("2000.00");
  await expect(page.getByText("over on PLB-SHOWER")).toHaveCount(0);
  await page.getByLabel("Bill number").fill("HP-E2E-PO");
  await page.getByLabel("Bill date").fill("2026-10-09");
  await page.getByLabel("Due date").fill("2026-10-20");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: "HP-E2E-PO" })).toBeVisible();
  await expect(page.getByRole("link", { name: "PO-1055" })).toBeVisible();
  await expect(page.locator("[data-status='draft']")).toBeVisible();
  await expect(page.getByLabel("Bill")).toContainText("$200.00");
});

test("purchase order detail on a phone", async ({ page, request }) => {
  await page.setViewportSize(devices["Pixel 5"].viewport);
  await resetDemo(request);
  await signIn(page);
  await page.goto("/purchase-orders/po_ok_retain");
  await expect(page.getByRole("heading", { level: 1, name: "PO-1055" })).toBeVisible();
  const fontSize = await page.locator("[data-detail='header'] h1").evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeLessThanOrEqual(16);
  await page.getByRole("button", { name: "New bill" }).click();
  await expect(page.getByLabel("Line 1 amount")).toHaveValue("2000.00");
});
