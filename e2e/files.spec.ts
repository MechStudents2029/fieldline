import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const harbor = "/v/demo_vendor_harbor_m3p8qx7k";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

const pdf = { name: "E-201.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") };

async function openPlan(page: Page, name: RegExp, current: boolean) {
  const width = page.viewportSize()?.width ?? 1440;
  const pane = page.getByRole("complementary", { name: "File" });
  if (width < 768 && (await pane.isVisible().catch(() => false))) {
    const heading = (await pane.getByRole("heading").first().textContent()) || "";
    if (name.test(heading)) {
      await pane.getByRole("button", { name: current ? / · Current/ : /Superseded/ }).click();
      return;
    }
    await page.getByRole("button", { name: "‹ Files" }).click();
  }
  if (width >= 768) {
    await page.getByRole("row", { name }).filter({ hasText: current ? "Current" : "Superseded" }).click();
  } else {
    await page.getByRole("button", { name }).filter({ hasText: current ? "Current" : "Superseded" }).click();
  }
}

async function jobFiles(page: Page, shots: boolean) {
  await page.goto("/projects/proj_okonkwo/files");
  const width = page.viewportSize()?.width ?? 1440;
  const list = width >= 768 ? page.getByRole("table", { name: "Files" }) : page.getByRole("list", { name: "Files" });
  await expect(list).toContainText("A-101 floor plan");
  await expect(list).toContainText("Current");
  await expect(list).toContainText("Superseded");
  await expect(list).toContainText("1.4 MB");
  await expect(list).toContainText("860 KB");
  await expect(list).not.toContainText("81 B");
  const folders = page.getByRole("navigation", { name: "Folders" });
  await expect(folders).toContainText("Plans");
  await expect(folders).toContainText("Contracts");
  await expect(folders).toContainText("Photos");
  const harbor = folders.getByRole("link", { name: /Harbor Plumbing/ });
  await expect(harbor).toContainText("Vendor");
  expect(await harbor.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await openPlan(page, /A-101 floor plan/, true);
  const pane = page.getByRole("complementary", { name: "File" });
  await expect(pane).toContainText("A-101 floor plan");
  await expect(pane).toContainText("Plans");
  await expect(pane).toContainText("Rev 2");
  await expect(pane).toContainText("Current");
  await expect(pane).toContainText("Superseded");
  await expect(pane.getByRole("button", { name: "Share history" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Upload new revision" })).toBeVisible();
  if (shots) {
    await shot(page, "job-files-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "job-files-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload" });
  await expect(dialog.getByLabel("Folder").locator("option:checked")).toHaveText("Plans");
  if (shots) {
    await shot(page, "job-files-upload-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "job-files-upload-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  await dialog.getByLabel("File").setInputFiles(pdf);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  if (width < 768) await page.getByRole("button", { name: "‹ Files" }).click();
  await expect(list).toContainText("E-201");
  await openPlan(page, /E-201/, true);
  await pane.getByLabel("Visibility E-201").selectOption("client");
  await expect(pane.getByRole("status")).toHaveText("Saved.");
  await pane.getByLabel("Revise E-201").setInputFiles(pdf);
  await pane.getByRole("button", { name: "Upload new revision" }).click();
  await expect(pane).toContainText("Rev 2");
  await openPlan(page, /E-201/, true);
  await pane.getByRole("button", { name: "Share history" }).click();
  await expect(pane.getByRole("button", { name: "Hide history" })).toBeVisible();
  await pane.getByRole("button", { name: "Delete" }).click();
  await expect(list).toContainText("E-201");
  await openPlan(page, /E-201/, true);
  await pane.getByRole("button", { name: "Delete" }).click();
  await expect(list).not.toContainText("E-201");
  await list.getByLabel("Select A-101 floor plan Rev 2").check();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await list.getByLabel("Select A-101 floor plan Rev 2").uncheck();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Folders" }).click();
  await expect(page.getByRole("dialog", { name: "Folders" })).toContainText("Add folder");
  await page.getByRole("button", { name: "Close" }).click();
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
    await files.locator("h2").evaluate((node) => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 24));
    });
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
