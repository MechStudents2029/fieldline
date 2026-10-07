import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const harbor = "/v/demo_vendor_harbor_m3p8qx7k";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function inboxToThread(page: Page) {
  await page.goto("/inbox");
  await expect(page.getByRole("list", { name: "Inbox" })).toContainText("RFI-001");
  await expect(page.getByRole("list", { name: "Inbox" })).toContainText("Luis Ortega");
  await page.keyboard.press("j");
  await expect(page.getByRole("list", { name: "Inbox" }).locator("[aria-current='true']")).toContainText("RFI-001");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/rfis\/rfi_ok_valve/);
  await expect(page.locator("[data-mention='Maya Rivera']")).toBeVisible();
  await page.getByRole("textbox", { name: "Comment" }).fill("Checked the height @Luis Ortega");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.locator("[data-mention='Luis Ortega']")).toBeVisible();
}

test("comment, mention, and inbox at 1440", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await expect(page.getByRole("link", { name: "Mentions" })).toBeVisible();
  await page.goto("/rfis");
  const number = page.getByRole("cell", { name: "RFI-001" }).first();
  await expect(number).toHaveCSS("white-space", "nowrap");
  await shot(page, "rfi-table-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "rfi-table-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await inboxToThread(page);
  await shot(page, "comment-thread-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "comment-thread-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/inbox");
  await shot(page, "inbox-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "inbox-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await page.goto(harbor);
  const vendor = page.locator("[data-rfi='Valve height']");
  await expect(vendor.getByText("No file chosen")).toHaveCount(0);
  await expect(vendor.getByRole("button", { name: "Photo", exact: true })).toBeVisible();
  await vendor.getByLabel("Photo Valve height").setInputFiles({ name: "valve-height.png", mimeType: "image/png", buffer: png });
  await expect(vendor.getByRole("button", { name: "valve-height.png" })).toBeVisible();
  await shot(page, "vendor-file-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "vendor-file-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await vendor.getByRole("button", { name: "Remove Photo Valve height" }).click();
  await expect(vendor.getByRole("button", { name: "Photo", exact: true })).toBeVisible();
  await expect(vendor.getByText("Valve center is 48 inches")).toHaveCount(0);
});

test.describe("comments on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("inbox opens the mention and the file button stays one line", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/inbox");
    await expect(page.getByRole("list", { name: "Inbox" })).toContainText("RFI-001");
    const age = page.getByRole("list", { name: "Inbox" }).locator(".num").first();
    await expect(age).toHaveCSS("white-space", "nowrap");
    await page.getByRole("link", { name: /RFI-001/ }).click();
    await expect(page.locator("[data-mention='Maya Rivera']")).toBeVisible();
    await page.goto(harbor);
    const vendor = page.locator("[data-rfi='Valve height']");
    await expect(vendor.getByText("No file chosen")).toHaveCount(0);
    await vendor.getByLabel("Photo Valve height").setInputFiles({ name: "valve-height.png", mimeType: "image/png", buffer: png });
    await expect(vendor.getByRole("button", { name: "valve-height.png" })).toBeVisible();
    await vendor.getByRole("button", { name: "Remove Photo Valve height" }).click();
    await expect(vendor.getByRole("button", { name: "Photo", exact: true })).toBeVisible();
  });
});
