import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const harbor = "/v/demo_vendor_harbor_m3p8qx7k";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function signBackIn(page: Page) {
  await page.goto("/login");
  const field = page.getByLabel("Email");
  if (!(await field.isVisible().catch(() => false))) {
    await page.goto("/more");
    await page.locator("#main").getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }
  await signIn(page);
}

async function officeAndVendor(page: Page, shots: boolean) {
  await expect(page.locator("a:visible", { hasText: "Submittals overdue" })).toBeVisible();
  await expect(page.locator("a:visible", { hasText: "Submittals awaiting your review" })).toBeVisible();
  await page.goto("/submittals");
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 768) {
    await expect(page.getByRole("button", { name: "Show" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter" })).toHaveCount(0);
    await page.getByLabel("Overdue").selectOption("1");
  } else {
    await expect(page.getByLabel("Overdue")).toBeHidden();
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByLabel("Overdue").selectOption("1");
  }
  await expect(page).toHaveURL(/overdue=1/);
  if (width >= 768) {
    await expect(page.getByRole("table", { name: "Submittals" })).toContainText("Shower valve cut sheet");
    await expect(page.getByRole("table", { name: "Submittals" })).not.toContainText("Tile sample");
  } else {
    await expect(page.getByRole("list", { name: "Submittal list" })).toContainText("Shower valve cut sheet");
    await expect(page.getByRole("list", { name: "Submittal list" })).not.toContainText("Tile sample");
  }
  if (shots) {
    await shot(page, "submittals-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "submittals-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.getByRole("link", { name: "Shower valve cut sheet" }).click();
  await expect(page.getByRole("heading", { name: /SUB-001/ })).toBeVisible();
  await expect(page.getByLabel("Revisions")).toContainText("Move the valve 2 inches.");
  await expect(page.getByLabel("Revisions")).toContainText("Revised cut sheet, valve moved.");
  await expect(page.getByText("valve-cut-sheet.pdf")).toBeVisible();
  await expect(page.getByText("Allowance stays in the office.")).toBeVisible();
  if (shots) {
    await shot(page, "submittal-detail-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "submittal-detail-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }

  await page.goto("/todos");
  await page.getByRole("link", { name: "Pre-drywall walk" }).first().click();
  const pane = page.getByRole("complementary", { name: "To-do" });
  await expect(pane.locator(".file-pick-btn")).toHaveText("Photo");
  await expect(pane.locator(".file-pick-btn")).toBeVisible();
  await expect(pane.getByLabel("Photo")).toHaveClass(/file-pick-input/);
  if (shots) {
    await shot(page, "todo-file-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "todo-file-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }

  await page.goto(harbor);
  const vendor = page.getByRole("region", { name: "Submittals" });
  await expect(vendor).toContainText("Shower valve cut sheet");
  await expect(vendor).not.toContainText("Tile sample");
  await expect(vendor).not.toContainText("Allowance stays");
  await vendor.getByLabel("Submittal title").fill("Trim ring");
  await vendor.getByLabel("Spec").fill("Chrome trim ring for the valve.");
  await vendor.getByLabel("Submittal due").fill("2026-12-20");
  await vendor.getByLabel("Submittal file").setInputFiles({ name: "trim.png", mimeType: "image/png", buffer: png });
  await vendor.getByRole("button", { name: "Send submittal" }).click();
  await expect(vendor.getByText("Submitted.")).toBeVisible();
  await expect(vendor).toContainText("Trim ring");

  await signBackIn(page);
  await page.goto("/submittals");
  await page.getByRole("link", { name: "Trim ring" }).click();
  await page.getByLabel("Review status").selectOption("approved");
  await page.getByLabel("Review note").fill("Approved for tile.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
}

test("office submittal list, detail, and a vendor submit at 1440", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await officeAndVendor(page, true);
});

test.describe("submittals on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("phone list, detail, and a vendor submit", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await officeAndVendor(page, false);
  });
});
