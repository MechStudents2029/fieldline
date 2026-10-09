import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function payReady(page: Page) {
  await page.goto("/bills?ready=1");
  await expect(page.getByRole("columnheader", { name: "Blocked by" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Waiver" })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /HP-510/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /HP-511/ })).toContainText("Waiver unsigned");
  await expect(page.getByRole("row", { name: /HP-511/ })).not.toContainText("Missing");
  await expect(page.getByRole("row", { name: /HP-511/ }).locator(".fl-pill")).toHaveCount(1);
  await expect(page.getByRole("row", { name: /HP-510/ }).locator(".fl-pill")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /HP-510/ })).not.toContainText("Waiver unsigned");
  await expect(page.locator("[data-ready-totals]")).toHaveText("1 · $1,800.00");
  await expect(page.getByRole("checkbox", { name: "Pay HP-511" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Pay HP-510" }).check();
  await page.getByLabel("Paid on").fill("2026-10-09");
  await page.getByLabel("Payment method").selectOption("check");
  await page.getByLabel("Payment reference").fill("5101");
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByRole("button", { name: "Request unconditional waiver" })).toBeVisible();
  await page.getByRole("button", { name: "Request unconditional waiver" }).click();
  await page.goto("/bills/bill_ok_ret_ready");
  await expect(page.getByLabel("Lien waivers")).toContainText("Unconditional progress");
  await page.goto("/purchase-orders/po_ok_retain");
  const facts = page.locator("[data-detail='facts']");
  await expect(facts).toContainText("10%");
  await expect(facts).toContainText("$200.00");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Release retainage" }).click();
  await expect(facts.getByRole("link", { name: "PO-1055-R" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Bills" }).getByRole("link", { name: "PO-1055-R" })).toBeVisible();
  await expect(facts).toContainText("$200.00");
}

test("ready to pay, bulk paid, and release retainage", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
  const bills = page.getByRole("region", { name: "Bills" });
  await bills.scrollIntoViewIfNeeded();
  await expect(bills).toContainText("HP-510");
  await expect(bills).toContainText("Retained");
  await expect(bills).not.toContainText("SL-1904");
  await shot(page, "vendor-bills-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "vendor-bills-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await page.goto("/bills?ready=1");
  await expect(page.locator("[data-ready-totals]")).toHaveText("1 · $1,800.00");
  await shot(page, "bills-ready-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "bills-ready-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await payReady(page);
  await shot(page, "po-retainage-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "po-retainage-dark");
  await page.emulateMedia({ colorScheme: "light" });
});

test("ready to pay on a phone", async ({ page, request }) => {
  await page.setViewportSize(devices["Pixel 5"].viewport);
  await resetDemo(request);
  await signIn(page);
  await payReady(page);
  await expect(page.getByRole("table", { name: "Bills" }).getByRole("link", { name: "PO-1055-R" })).toBeVisible();
});
