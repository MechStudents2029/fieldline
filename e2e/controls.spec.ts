import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const routes = [
  "/",
  "/inbox",
  "/pipeline",
  "/projects",
  "/todos",
  "/estimates",
  "/schedule",
  "/rfis",
  "/submittals",
  "/purchase-orders",
  "/invoices",
  "/bills",
  "/time",
  "/reports/wip",
  "/contacts",
  "/settings",
  "/settings/files",
  "/import",
  "/projects/proj_okonkwo/files",
  "/portal/demo_portal_okonkwo",
  "/v/demo_vendor_harbor_m3p8qx7k",
];

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function lines(locator: Locator) {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(
      [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top)),
    );
    return tops.size;
  });
}

async function assertCompact(page: Page, route: string) {
  const selects = page.locator("[data-bar] select:visible, [data-pane] select:not(.field):visible, [data-sheet] select:not(.field):visible");
  const selectCount = await selects.count();
  for (let index = 0; index < selectCount; index += 1) {
    const select = selects.nth(index);
    const box = await select.boundingBox();
    const label = (await select.getAttribute("aria-label")) || "select";
    expect(box, `${route} ${label}`).toBeTruthy();
    expect(box!.width, `${route} ${label} width`).toBeLessThanOrEqual(264);
    expect(box!.height, `${route} ${label} height`).toBeLessThanOrEqual(32);
  }

  const files = page.locator('input[type="file"]');
  const fileCount = await files.count();
  for (let index = 0; index < fileCount; index += 1) {
    const input = files.nth(index);
    const shown = await input.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (el.classList.contains("file-pick-input") || el.classList.contains("sr-only")) return false;
      return rect.width > 8 && rect.height > 8;
    });
    expect(shown, `${route} file ${(await input.getAttribute("aria-label")) || index}`).toBe(false);
  }

  const buttons = page.locator("[data-bar] button:visible, [data-sheet] button:visible, [data-pane='file'] button:visible, .file-pick-btn:visible");
  const buttonCount = await buttons.count();
  for (let index = 0; index < buttonCount; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox();
    const name = ((await button.innerText()) || "button").replace(/\s+/g, " ").trim();
    const klass = (await button.getAttribute("class")) || "";
    expect(klass, `${route} unstyled ${name}`).toMatch(/ctl|mac-|file-pick|fit|bg-transparent/);
    expect(box, `${route} ${name}`).toBeTruthy();
    expect(box!.height, `${route} ${name} height`).toBeLessThanOrEqual(40);
  }

  const cells = page.locator("[data-fit]:visible");
  const cellCount = await cells.count();
  for (let index = 0; index < cellCount; index += 1) {
    const cell = cells.nth(index);
    const count = await lines(cell);
    const text = ((await cell.innerText()) || "").replace(/\s+/g, " ").trim();
    expect(count, `${route} wraps “${text.slice(0, 40)}”`).toBeLessThanOrEqual(1);
  }
}

test("compact controls stay on one row", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  for (const route of routes) {
    await page.goto(route);
    await assertCompact(page, route);
  }

  await page.goto("/bills");
  await expect(page.getByLabel("Waiver type")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Waiver HP-441" }).check();
  await page.getByRole("checkbox", { name: "Waiver HP-220" }).check();
  const bar = page.getByRole("region", { name: "Waiver request" });
  await expect(bar).toContainText("2 selected");
  await expect(bar.getByRole("button", { name: "Request waiver" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Clear" })).toBeVisible();
  const typeBox = await bar.getByLabel("Waiver type").boundingBox();
  const requestBox = await bar.getByRole("button", { name: "Request waiver" }).boundingBox();
  const clearBox = await bar.getByRole("button", { name: "Clear" }).boundingBox();
  expect(typeBox && requestBox && clearBox).toBeTruthy();
  expect(Math.abs(typeBox!.y - requestBox!.y)).toBeLessThan(8);
  expect(Math.abs(requestBox!.y - clearBox!.y)).toBeLessThan(8);
  expect(typeBox!.width).toBeLessThanOrEqual(264);
  expect(typeBox!.height).toBeLessThanOrEqual(32);
  await assertCompact(page, "/bills selected");
  await shot(page, "bills-selected-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "bills-selected-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_okonkwo/files");
  await page.getByRole("row", { name: /A-101 floor plan/ }).filter({ hasText: "Current" }).click();
  const pane = page.getByRole("complementary", { name: "File" });
  await expect(pane.getByRole("button", { name: "Upload new revision" })).toBeVisible();
  await expect(pane.getByLabel("Revise A-101 floor plan")).toBeAttached();
  const visibility = pane.getByLabel("Visibility A-101 floor plan");
  const visibilityBox = await visibility.boundingBox();
  const reviseBox = await pane.getByRole("button", { name: "Upload new revision" }).boundingBox();
  expect(visibilityBox && reviseBox).toBeTruthy();
  expect(visibilityBox!.width).toBeLessThanOrEqual(264);
  expect(visibilityBox!.height).toBeLessThanOrEqual(32);
  expect(Math.abs(visibilityBox!.height - reviseBox!.height)).toBeLessThanOrEqual(8);
  const rev = page.locator("[data-fit='status']", { hasText: "Rev 2 · Current" }).first();
  expect(await lines(rev)).toBe(1);
  const date = page.locator("td[data-fit='date']").first();
  expect(await lines(date)).toBe(1);
  const size = page.locator("td[data-fit='size']", { hasText: "1.4 MB" }).first();
  expect(await lines(size)).toBe(1);
  await assertCompact(page, "job files");
  await shot(page, "job-files-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "job-files-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Upload" }).getByLabel("Folder")).toBeVisible();
  await assertCompact(page, "upload sheet");
  await page.keyboard.press("Escape");

  await page.goto("/invoices");
  await assertCompact(page, "/invoices");
  await shot(page, "invoices-controls-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "invoices-controls-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/settings");
  await assertCompact(page, "/settings");
  await shot(page, "settings-controls-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "settings-controls-dark");
  await page.emulateMedia({ colorScheme: "light" });
});
