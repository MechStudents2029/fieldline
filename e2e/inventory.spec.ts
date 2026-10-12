import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: false });
}

test("receive to stock skips damage and adds a good receipt", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/inventory");
  await expect(page.getByRole("table", { name: "Inventory" })).toContainText("Floor tile, set");
  await expect(page.getByRole("table", { name: "Inventory" })).toContainText("Low");
  await shot(page, "inventory-list");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "inventory-list-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("link", { name: "Shower valve and head" }).click();
  await expect(page.getByRole("table", { name: "Locations" })).toContainText("2 ea");
  await expect(page.getByRole("table", { name: "Movements" })).toContainText("MV-1044");
  await shot(page, "inventory-item");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "inventory-item-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/purchase-orders/po_ok_harbor");
  await page.getByRole("button", { name: "Receive" }).click();
  const sheet = page.getByRole("dialog", { name: "Receive" });
  await sheet.getByLabel("Qty Valve, trim, and remaining rough").fill("0.5");
  await sheet.getByLabel("Condition Valve, trim, and remaining rough").selectOption("damaged");
  await sheet.getByLabel("Stock location").selectOption("Yard");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(sheet.getByRole("status")).toContainText("PO-1044 received");
  await page.goto("/inventory/stk_valve");
  await expect(page.getByRole("table", { name: "Locations" })).toContainText("2 ea");
  await page.goto("/purchase-orders/po_ok_harbor");
  await page.getByRole("button", { name: "Receive" }).click();
  const again = page.getByRole("dialog", { name: "Receive" });
  await again.getByLabel("Qty Valve, trim, and remaining rough").fill("1");
  await again.getByLabel("Stock location").selectOption("Yard");
  await again.getByRole("button", { name: "Save receipt" }).click();
  await expect(again.getByRole("status")).toContainText("PO-1044 received");
  await page.goto("/inventory/stk_valve");
  await expect(page.getByRole("table", { name: "Locations" })).toContainText("3 ea");
});

test("issue to a job posts the stock cost once", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/projects/proj_okonkwo");
  await expect(page.getByText("$222.00 issued")).toBeVisible();
  await page.goto("/inventory/stk_tile");
  await page.getByLabel("Issue from").selectOption("Yard");
  await page.getByLabel("Issue job").selectOption("Okonkwo primary bath");
  await page.getByLabel("Issue qty").fill("5");
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByRole("status").first()).toContainText("Issued.");
  await expect(page.getByRole("row", { name: /Yard/ }).first()).toContainText("95");
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByRole("status").first()).toContainText(/Already recorded|Enter a quantity/);
  await expect(page.getByRole("row", { name: /Yard/ }).first()).toContainText("95");
  await page.goto("/projects/proj_okonkwo");
  await expect(page.getByText("$314.50 issued")).toBeVisible();
});

test("job to job moves the quantity and the cost", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/inventory/stk_tile");
  await expect(page.getByRole("table", { name: "Movements" })).toContainText("Job transfer");
  await page.getByLabel("From job").selectOption("Okonkwo primary bath");
  await page.getByLabel("To job").selectOption("Brooks family room addition");
  await page.getByLabel("Job qty").fill("4");
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Transferred." })).toBeVisible();
  await page.goto("/projects/proj_okonkwo");
  await expect(page.getByText("$148.00 issued")).toBeVisible();
  await expect(page.getByText("8 sf")).toBeVisible();
  await page.goto("/projects/proj_brooks");
  await expect(page.getByText("$222.00 issued")).toBeVisible();
  await expect(page.getByText("12 sf")).toBeVisible();
});

test("reorder opens one draft and a second click does not add a line", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await revealToday(page, "Low stock");
  await page.getByRole("link", { name: /Low stock/ }).click();
  await expect(page).toHaveURL(/\/inventory\?low=1/);
  await expect(page.getByRole("table", { name: "Inventory" })).toContainText("Shower valve and head");
  await expect(page.getByRole("table", { name: "Inventory" })).not.toContainText("Floor tile");
  await page.getByRole("link", { name: "Shower valve and head" }).click();
  await page.getByRole("button", { name: "Order" }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/po_/);
  const po = page.url();
  await expect(page.getByRole("table", { name: "Lines" })).toContainText("Shower valve and head");
  await expect(page.getByRole("cell", { name: "Shower valve and head" })).toHaveCount(1);
  await page.goto("/inventory/stk_valve");
  await page.getByRole("button", { name: "Order" }).click();
  await expect(page).toHaveURL(po);
  await expect(page.getByRole("cell", { name: "Shower valve and head" })).toHaveCount(1);
});

test("field can return leftover tile to the yard without seeing cost", async ({ page, request }) => {
  await page.setViewportSize(devices["Pixel 5"].viewport);
  await resetDemo(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await page.goto("/inventory/stk_tile");
  await expect(page.getByRole("heading", { name: "Floor tile, set" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$");
  await expect(page.getByRole("button", { name: "Order" })).toHaveCount(0);
  await page.getByLabel("Return from").selectOption("Okonkwo primary bath");
  await page.getByLabel("Return to").selectOption("Yard");
  await page.getByLabel("Return qty").fill("2");
  await page.getByRole("button", { name: "Return" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Returned." })).toBeVisible();
  await expect(page.getByRole("row", { name: /Yard/ }).first()).toContainText("102");
  await expect(page.locator("body")).not.toContainText("$");
});
