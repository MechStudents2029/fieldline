import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const harbor = "/v/demo_vendor_harbor_m3p8qx7k";

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

async function submittalsOpen(page: Page, shots: boolean) {
  await page.goto("/submittals");
  const width = page.viewportSize()?.width ?? 1440;
  const list = width >= 768 ? page.getByRole("table", { name: "Submittals" }) : page.getByRole("list", { name: "Submittal list" });
  await expect(list).toContainText("Shower valve cut sheet");
  await expect(list).toContainText("Tile sample");
  if (width >= 768) {
    const overdue = page.getByLabel("Overdue");
    await expect(overdue).toBeVisible();
    const clipped = await overdue.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
    await expect(overdue).toHaveValue("");
  } else {
    await page.getByRole("button", { name: "Filter" }).click();
    const overdue = page.getByLabel("Overdue");
    await expect(overdue).toBeVisible();
    const clipped = await overdue.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  }
  if (shots) {
    await shot(page, "submittals-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "submittals-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
}

async function requestSignAndPay(page: Page, shots: boolean) {
  await page.goto("/bills");
  const width = page.viewportSize()?.width ?? 1440;
  await expect(page.getByRole("table", { name: "Bills" })).toContainText("HP-220");
  await expect(page.getByRole("table", { name: "Bills" })).toContainText("Signed");
  await expect(page.getByRole("table", { name: "Bills" })).toContainText("Requested");
  if (width < 768) await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByLabel("Waiver", { exact: true })).toBeVisible();
  const bills = page.getByRole("table", { name: "Bills" });
  await expect(bills).toContainText("Paid");
  await expect(bills).toContainText("Approved");
  await expect(bills).toContainText("Draft");
  await expect(page.getByRole("cell", { name: "Diaz deck replacement", exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Waiver type")).toHaveCount(0);
  const vendors = page.getByRole("table", { name: "Vendors" });
  await expect(vendors).toContainText("Harbor Plumbing");
  await expect(vendors).toContainText("Open PO");
  await expect(vendors).toContainText("PLB-SHOWER");
  if (shots) {
    await page.getByRole("row", { name: /HP-220/ }).scrollIntoViewIfNeeded();
    await shot(page, "bills-waivers-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "bills-waivers-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.getByLabel("Waiver HP-441").check();
  await page.getByLabel("Waiver HP-220").check();
  await expect(page.getByRole("region", { name: "Waiver request" })).toContainText("2 selected");
  await expect(page.getByLabel("Waiver type")).toBeVisible();
  if (shots) {
    await page.getByRole("row", { name: /HP-220/ }).scrollIntoViewIfNeeded();
    await shot(page, "bills-selected-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "bills-selected-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("heading", { name: "Vendors" }).evaluate((node) => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 24));
    });
    await shot(page, "bills-vendors-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "bills-vendors-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.getByLabel("Waiver HP-220").uncheck();
  await page.getByRole("button", { name: "Request waiver" }).click();
  await page.getByRole("link", { name: /HP-441/ }).click();
  await expect(page.getByLabel("Lien waivers")).toContainText("Requested");
  await page.goto(harbor);
  const card = page.getByRole("region", { name: "Lien waivers" });
  await expect(card).toContainText("HP-441");
  await expect(card).toContainText("waives lien rights");
  await expect(card).not.toContainText("SL-1904");
  if (shots) {
    await card.scrollIntoViewIfNeeded();
    await shot(page, "vendor-waiver-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "vendor-waiver-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  await card.getByLabel("Sign HP-441").fill("Pete Alvarez");
  await card.getByRole("button", { name: "Sign HP-441" }).click();
  await expect(card.getByLabel("Sign HP-441")).toHaveCount(0);
  await signBackIn(page);
  await page.goto("/bills");
  await page.getByRole("link", { name: /HP-441/ }).click();
  await expect(page.getByLabel("Lien waivers")).toContainText("Signed");
  await page.getByLabel("Paid on").fill("2026-10-09");
  await page.getByLabel("Payment reference").fill("4455");
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.locator("[data-detail='facts']")).toContainText("Oct 9 · check · 4455");
  await expect(page.getByText("Lien waiver is not signed.")).toHaveCount(0);
  await page.getByRole("button", { name: "Request unconditional waiver" }).click();
  await expect(page.getByLabel("Lien waivers")).toContainText("Unconditional progress");
  await expect(page.getByLabel("Lien waivers")).toContainText("Requested");
  const print = page.getByRole("link", { name: "Print" }).first();
  await print.click();
  await expect(page.getByRole("heading", { name: "Conditional progress" })).toBeVisible();
  await expect(page.getByText("Pete Alvarez")).toBeVisible();
  if (shots) {
    await shot(page, "waiver-print-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "waiver-print-dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
}

test("request a waiver, sign it, mark the bill paid, and ask for the unconditional", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await submittalsOpen(page, true);
  await requestSignAndPay(page, true);
});

test.describe("waivers on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("phone list, vendor sign, and the unconditional prompt", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await submittalsOpen(page, false);
    await requestSignAndPay(page, false);
  });
});
