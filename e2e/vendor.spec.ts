import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const portal = "/v/demo_vendor_harbor_m3p8qx7k";

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  const field = page.getByLabel("Email");
  if (!(await field.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }
  await field.fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

async function acceptAndBill(page: Page, billNumber: string) {
  await page.goto(portal);
  await expect(page.getByRole("heading", { name: "Harbor Plumbing" })).toBeVisible();
  await expect(page.locator("[data-open-pos]")).toHaveText("1");
  await expect(page.getByText("Set the valve")).toBeVisible();
  await expect(page.getByText("901 Mandana Blvd, Oakland, CA")).toBeVisible();
  await expect(page.getByText("Replace the escutcheon", { exact: true })).toBeVisible();
  await expect(page.getByText("Amara")).toHaveCount(0);
  await expect(page.getByText("Dana Cho")).toHaveCount(0);
  await expect(page.getByText("$46,200")).toHaveCount(0);
  const orders = page.getByRole("region", { name: "Purchase orders" });
  await orders.getByLabel("Name PO-1044").fill("Pete Alvarez");
  await orders.getByRole("button", { name: "Accept PO-1044" }).click();
  await expect(orders.getByText("Accepted", { exact: true })).toBeVisible();
  await orders.getByLabel("Bill number PO-1044").fill(billNumber);
  await orders.getByLabel("Amount PLB-SHOWER").fill("100");
  await orders.getByRole("button", { name: "Send bill" }).click();
  await expect(page.locator("[data-bill]", { hasText: billNumber })).toContainText("Draft");
  const certs = page.getByRole("region", { name: "Certificates" });
  const today = (await page.locator("main").getAttribute("data-today")) || "2026-10-07";
  const expires = today.replace(/^(\d{4})/, (year) => String(Number(year) + 2));
  await certs.getByLabel("Expires").fill(expires);
  await certs.getByLabel("Certificate file").setInputFiles({ name: "wc.png", mimeType: "image/png", buffer: png });
  await certs.getByRole("button", { name: "Save certificate" }).click();
  await expect(page.locator("[data-cert=workers_comp]")).toContainText("Current");
}

test("office vendor compliance, portal bill, and draft review at 1440", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible", { hasText: "Vendor certificates" })).toContainText("1");
  await expect(page.locator("a:visible", { hasText: "Warranty requests" })).toContainText("1");
  await expect(page.locator("a:visible", { hasText: "Floor tile" })).toHaveCount(1);

  await page.goto("/contacts/c_harbor");
  await expect(page.getByRole("heading", { name: "Pete Alvarez" })).toBeVisible();
  await expect(page.locator("[data-compliance=missing]")).toBeVisible();
  await expect(page.locator("[data-cert=general_liability]")).toContainText(/Expires in/);
  await expect(page.locator("[data-cert=workers_comp]")).toContainText("Missing");
  await expect(page.getByRole("button", { name: "New link" })).toBeVisible();

  await acceptAndBill(page, "HP-902");

  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible", { hasText: "Vendor bills" })).toContainText("1");
  await page.locator("a:visible", { hasText: "Vendor bills" }).click();
  await expect(page.getByRole("heading", { name: "HP-902" })).toBeVisible();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
  await page.goto("/contacts/c_harbor");
  await expect(page.locator("[data-cert=workers_comp]")).toContainText("Current");
});

test.describe("vendor portal on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("accepts a PO, sends a draft bill, and uploads a certificate", async ({ page, request }) => {
    await resetDemo(request);
    await acceptAndBill(page, "HP-903");
    await signInAs(page, "maya@rivera.demo");
    await expect(page.locator("a:visible", { hasText: "Vendor bills" })).toContainText("1");
    await page.locator("a:visible", { hasText: "Vendor bills" }).click();
    await expect(page.getByRole("heading", { name: "HP-903" })).toBeVisible();
    await expect(page.getByText("draft", { exact: true })).toBeVisible();
  });
});
