import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const harbor = "/v/demo_vendor_harbor_m3p8qx7k";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function jobFiles(page: Page, shots: boolean) {
  await page.goto("/projects/proj_okonkwo/files");
  const width = page.viewportSize()?.width ?? 1440;
  const list = width >= 768 ? page.getByRole("table", { name: "Files" }) : page.getByRole("list", { name: "Files" });
  await expect(list).toContainText("A-101 floor plan");
  await expect(list).toContainText("Current");
  await expect(list).toContainText("Superseded");
  await expect(page.getByRole("navigation", { name: "Folders" })).toContainText("Plans");
  await expect(page.getByRole("navigation", { name: "Folders" })).toContainText("Contracts");
  await expect(page.getByRole("navigation", { name: "Folders" })).toContainText("Photos");
  if (shots) {
    await list.scrollIntoViewIfNeeded();
    await shot(page, "job-files-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "job-files-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
}

async function vendorFiles(page: Page, shots: boolean) {
  await page.goto(harbor);
  const files = page.getByRole("region", { name: "Files" });
  await expect(files).toContainText("A-101 floor plan");
  await expect(files).toContainText("Rev 2");
  await expect(files).not.toContainText("Superseded");
  await expect(files).not.toContainText("Contracts");
  await expect(files).toContainText("Valve photo");
  if (shots) {
    await files.scrollIntoViewIfNeeded();
    await shot(page, "vendor-files-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "vendor-files-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  const current = await page.request.get("/api/files/doc_ok_a101_r2?vendor=demo_vendor_harbor_m3p8qx7k");
  expect(current.ok()).toBeTruthy();
  const old = await page.request.get("/api/files/doc_ok_a101_r1?vendor=demo_vendor_harbor_m3p8qx7k");
  expect(old.status()).toBe(404);
  const client = await page.request.get("/api/files/doc_ok_a101_r2?portal=demo_portal_okonkwo");
  expect(client.status()).toBe(404);
}

test("job files and the vendor plan", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await jobFiles(page, true);
  await vendorFiles(page, true);
  await page.goto("/portal/demo_portal_okonkwo");
  const clientFiles = page.getByRole("region", { name: "Files" });
  await expect(clientFiles).toContainText("Photos");
  await expect(clientFiles).not.toContainText("A-101");
  await expect(clientFiles).not.toContainText("Contracts");
});

test.describe("files on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("job files and the vendor plan", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await jobFiles(page, false);
    await vendorFiles(page, false);
  });
});
