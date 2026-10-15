import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function shot(page: Page, name: string) {
  const buffer = await page.screenshot();
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const path = `/opt/cursor/artifacts/${name}.png`;
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.writeFileSync(path, buffer);
      return;
    } catch (error) {
      last = error;
      if (!String(error).includes("EIO")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw last;
}

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

test("captures a receipt, posts it, and marks it reimbursed", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetDemo(request);
  await signInAs(page, "dana@rivera.demo");
  const form = page.getByRole("region", { name: "Receipt" });
  await form.getByLabel("Receipt photo").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
  await form.getByLabel("Job").selectOption({ label: "Brooks family room addition" });
  await form.getByLabel("Store").fill("City Supply");
  await form.getByLabel("Date").fill("2026-10-14");
  await form.getByLabel("Total").fill("12.50");
  await form.getByLabel("Cost code").fill("FRM-WALL");
  await form.getByLabel("Paid with").selectOption("personal");
  await form.getByRole("button", { name: "Add receipt" }).click();
  await page.waitForURL(/\/receipts\/cr_/);
  const receiptUrl = page.url();
  await expect(page.locator("[data-receipt-detail]")).toHaveAttribute("data-status", "coded");
  await expect(page.getByText("Personal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post" })).toHaveCount(0);

  await signInAs(page, "riley@rivera.demo");
  await page.goto(receiptUrl);
  await expect(page.getByRole("button", { name: "Post" })).toHaveCount(0);

  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible").filter({ hasText: "Receipts" }).filter({ hasText: "2" })).toBeVisible();
  await page.goto(receiptUrl);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.locator("[data-receipt-detail]")).toHaveAttribute("data-status", "posted");
  await page.goto("/reimbursements");
  const row = page.locator("li", { hasText: "City Supply" });
  await expect(row).toContainText("$12.50");
  await row.getByRole("button", { name: "Mark reimbursed" }).click();
  await expect(row).toContainText("Reimbursed");
  await expect(row).toContainText("Maya Rivera");
  await shot(page, "reimbursements-light");

  await page.goto("/receipts?status=new");
  const depot = page.locator("li[data-vendor='Home Depot']");
  await expect(depot.locator("[data-duplicate]")).toBeVisible();
  await depot.locator("[data-duplicate]").click();
  await expect(page.locator("[data-receipt-detail]")).toBeVisible();
  await expect(page.locator("[data-duplicate]").first()).toBeVisible();
  await shot(page, "receipts-inbox-light");

  await page.goto("/receipts/cr_kiosk");
  await expect(page.locator("[data-reject-note]")).toHaveText("Not this job.");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/receipts?status=posted");
  await expect(page.getByRole("link", { name: "City Supply" })).toBeVisible();
  await expect(page.getByText("Office float")).toHaveCount(0);
  await page.goto("/reimbursements");
  await expect(page.locator("[data-person]")).toHaveCount(1);
  await expect(page.locator("[data-person='Dana Cho']")).toBeVisible();
  await expect(page.locator("li", { hasText: "City Supply" })).toContainText("Reimbursed");
});
