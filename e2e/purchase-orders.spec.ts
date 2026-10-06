import { devices, expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test("issue a purchase order, link a bill, and watch committed fall as actual rises", async ({ page, request }) => {
  await resetDemo(request);
  await signInAs(page, "maya@rivera.demo");
  await page.goto("/purchase-orders/new");
  await page.getByLabel("Job", { exact: true }).selectOption({ label: "Chen powder room" });
  await page.getByLabel("Sub or vendor").selectOption({ label: "Harbor Plumbing" });
  await page.getByLabel("Scope").fill("Toilet fixture package");
  await page.getByLabel("Line 1 cost code").fill("PLB-TOILET");
  await page.getByLabel("Line 1 amount").fill("500.00");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/PO-\d+/);
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  await expect(page.locator(".uppercase").getByText("draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Issue purchase order" }).click();
  await expect(page.locator(".uppercase").getByText("issued", { exact: true })).toBeVisible();

  await page.goto("/projects/proj_chen");
  const row = page.locator('[data-code="PLB-TOILET"]');
  await expect(row.locator('[data-kind="committed"]')).toHaveText("$500.00");
  await expect(row.locator('[data-kind="actual"]')).toHaveText("$0.00");

  await page.goto("/bills/new");
  await page.getByLabel("Job", { exact: true }).selectOption({ label: "Chen powder room" });
  await page.getByLabel("Sub or vendor").selectOption({ label: "Harbor Plumbing" });
  await page.getByLabel("Purchase order").selectOption({ label: `${number} · Harbor Plumbing · Chen powder room` });
  await page.getByLabel("Bill number").fill("PO-E2E-1");
  await page.getByLabel("Bill date").fill("2026-10-01");
  await page.getByLabel("Due date").fill("2026-10-20");
  await page.getByLabel("Line 1 cost code").fill("PLB-TOILET");
  await page.getByLabel("Line 1 amount").fill("200.00");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: "PO-E2E-1" })).toBeVisible();
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  await page.getByRole("button", { name: "Approve bill" }).click();
  await expect(page.locator(".uppercase").getByText("approved", { exact: true })).toBeVisible();

  await page.goto("/projects/proj_chen");
  const after = page.locator('[data-code="PLB-TOILET"]');
  await expect(after.locator('[data-kind="committed"]')).toHaveText("$300.00");
  await expect(after.locator('[data-kind="actual"]')).toHaveText("$200.00");
});

test.describe("phone purchase orders", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("field on a phone does not see purchase orders", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await page.goto("/more");
    await expect(page.getByRole("link", { name: "Purchase orders", exact: true })).toHaveCount(0);
    await page.goto("/purchase-orders");
    await expect(page.getByRole("heading", { name: "Purchase orders" })).toBeVisible();
    await expect(page.getByText("$")).toHaveCount(0);
  });
});
