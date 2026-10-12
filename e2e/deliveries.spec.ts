import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: false });
}

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test("office receive keeps a partial receipt", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/purchase-orders/po_ok_harbor");
  await expect(page.getByText("Partially received").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Lines" })).toContainText("1.5 of 4");
  await shot(page, "po-partial");
  await page.getByRole("button", { name: "Receive" }).click();
  const sheet = page.getByRole("dialog", { name: "Receive" });
  await sheet.getByLabel("Qty Valve, trim, and remaining rough").fill("0.5");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(sheet.getByRole("status")).toContainText("PO-1044 received");
  await page.goto("/purchase-orders/po_ok_harbor");
  await expect(page.getByRole("table", { name: "Lines" })).toContainText("2 of 4");
  await expect(page.getByText("Partially received").first()).toBeVisible();
});

test("phone receive hides prices", async ({ page, request }) => {
  await page.setViewportSize(devices["Pixel 5"].viewport);
  await resetDemo(request);
  await signInAs(page, "dana@rivera.demo");
  await page.goto("/deliveries");
  await expect(page.getByRole("heading", { name: "Deliveries" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Deliveries" })).not.toContainText("$");
  await page.getByRole("button", { name: "Receive" }).click();
  const sheet = page.getByRole("dialog", { name: "Receive" });
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toContainText("$");
  await shot(page, "phone-receive");
  await sheet.getByLabel("Qty Valve, trim, and remaining rough").fill("1");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(sheet.getByRole("status")).toContainText("received");
});

test("bill past received warns and needs an override", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/bills/bill_ok_over");
  await expect(page.getByRole("alert")).toContainText("Billed past received");
  await shot(page, "bill-warning");
  await page.getByRole("button", { name: "Approve bill" }).click();
  await expect(page.getByText("Enter a reason to bill more than received.")).toBeVisible();
  await page.getByLabel("Override reason").fill("Accepted the short ship");
  await page.getByRole("button", { name: "Approve bill" }).click();
  await expect(page.getByRole("status")).toContainText("Approved");
});

test("Today lists deliveries due today and late ones", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await revealToday(page, "Deliveries today");
  await revealToday(page, "Late deliveries");
  await expect(page.getByRole("link", { name: /Deliveries today/ })).toBeVisible();
  await page.getByRole("link", { name: /Late deliveries/ }).click();
  await expect(page).toHaveURL(/\/deliveries\?status=late/);
  await expect(page.getByRole("table", { name: "Deliveries" })).toContainText("PO-1042");
  await page.goto("/deliveries");
  await expect(page.getByRole("table", { name: "Deliveries" })).toContainText("PO-1044");
  await shot(page, "deliveries-list");
});
