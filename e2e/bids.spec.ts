import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday } from "./helpers";

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

function dueDate() {
  const day = new Date();
  day.setDate(day.getDate() + 10);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
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

async function vendorToken(page: Page, contactPath: string) {
  await page.goto(contactPath);
  await page.getByRole("button", { name: "Create link" }).click();
  const link = page.getByLabel("Portal link");
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  return new URL(url).pathname;
}

async function createAndAward(page: Page) {
  await page.goto("/projects/proj_okonkwo/bids");
  await expect(page.getByRole("heading", { name: "Bids" })).toBeVisible();
  await page.getByLabel("Title").fill("Trim package");
  await page.getByLabel("Due").fill(dueDate());
  await page.getByLabel("Line PLB-SHOWER").check();
  await page.getByLabel("Line BATH-GLASS").check();
  await page.getByLabel("Invite Harbor Plumbing").check();
  await page.getByLabel("Invite Casa Tile").check();
  await page.getByRole("button", { name: "Request bids" }).click();
  await expect(page.getByRole("link", { name: /Trim package/ })).toBeVisible();
  await page.getByRole("link", { name: /Trim package/ }).click();
  await expect(page.getByRole("heading", { name: "Trim package" })).toBeVisible();

  await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
  const harbor = page.locator("[data-bid-title='Trim package']");
  await harbor.getByLabel("Price PLB-SHOWER Trim package").fill("100");
  await harbor.getByLabel("Price BATH-GLASS Trim package").fill("200");
  await harbor.getByLabel("Name Trim package").fill("Pete Alvarez");
  await harbor.getByRole("button", { name: "Send Trim package" }).click();
  await expect(harbor.getByText("Submitted", { exact: true })).toBeVisible();

  const casa = await vendorToken(page, "/contacts/c_casa");
  await page.goto(casa);
  const casaBid = page.locator("[data-bid-title='Trim package']");
  await casaBid.getByLabel("Price PLB-SHOWER Trim package").fill("180");
  await casaBid.getByLabel("Price BATH-GLASS Trim package").fill("80");
  await casaBid.getByLabel("Name Trim package").fill("Imani Brooks");
  await casaBid.getByRole("button", { name: "Send Trim package" }).click();
  await expect(casaBid.getByText("Submitted", { exact: true })).toBeVisible();

  await page.goto("/projects/proj_okonkwo/bids");
  await page.getByRole("link", { name: /Trim package/ }).click();
  await page.getByLabel("Award PLB-SHOWER Harbor Plumbing").check();
  await page.getByLabel("Award BATH-GLASS Casa Tile").check();
  await page.getByLabel("Update budget").check();
  await page.getByRole("button", { name: "Award" }).click();
  await expect(page.getByRole("link", { name: "PO-1057" })).toBeVisible();
  await expect(page.getByRole("link", { name: "PO-1058" })).toBeVisible();
  await page.getByRole("link", { name: "PO-1057" }).click();
  await expect(page.locator("[data-status='draft']")).toBeVisible();

  await page.goto("/projects/proj_okonkwo");
  await expect(page.locator("[data-code='PLB-SHOWER'] [data-kind='budget']")).toHaveText("$100");
  await expect(page.locator("[data-code='BATH-GLASS'] [data-kind='budget']")).toHaveText("$80");
  await expect(page.locator("body")).toContainText("Contract $46,200.00");
}

test("office bid, vendor prices, and per-line award at 1440", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signInAs(page, "maya@rivera.demo");
  await revealToday(page, "Bids due");
  await expect(page.locator("a:visible", { hasText: "Bids due" })).toContainText("1");
  await expect(page.locator("a:visible", { hasText: "Bids to award" })).toContainText("1");
  await expect(page.locator("a:visible", { hasText: "Floor tile" })).toHaveCount(1);
  await createAndAward(page);
});

test("levels a no-bid and flags an open vendor", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetDemo(request);
  await signInAs(page, "maya@rivera.demo");
  await page.goto("/bids/bid_ok_valve");
  await expect(page.getByRole("heading", { name: "Shower plumbing and glass" })).toBeVisible();
  const harbor = page.locator("th[data-vendor='Harbor Plumbing']");
  await expect(harbor.locator("[data-raw]")).toHaveText("$4,800.00");
  await expect(harbor.locator("[data-leveled]")).toHaveText("$8,400.00");
  await expect(harbor.locator("[data-incomplete]")).toHaveCount(0);
  const casa = page.locator("th[data-vendor='Casa Tile']");
  await expect(casa.locator("[data-raw]")).toHaveText("$9,000.00");
  await expect(casa.locator("[data-leveled]")).toHaveText("$9,000.00");
  await expect(page.locator("th[data-vendor='Brighton Electric'] [data-incomplete]")).toHaveText("Incomplete");
  const glass = page.locator("td[data-vendor='Harbor Plumbing'][data-line='BATH-GLASS']");
  await expect(glass).toContainText("No bid");
  await expect(glass.locator("[data-plug]")).toHaveText("$3,600.00");
  await expect(page.getByLabel("Award BATH-GLASS Harbor Plumbing")).toHaveCount(0);
  await expect(page.getByLabel("Award BATH-GLASS Casa Tile")).toBeVisible();
  await shot(page, "bid-level-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "bid-level-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
  await expect(page.locator("body")).toContainText("No bid");
  await expect(page.locator("body")).not.toContainText("$3,600.00");
  await expect(page.locator("body")).not.toContainText("Glass allowance");

  await page.goto("/bids/bid_ok_valve");
  await glass.getByLabel("Plug BATH-GLASS Harbor Plumbing").fill("4100");
  await glass.getByRole("button", { name: "Plug" }).click();
  await expect(harbor.locator("[data-leveled]")).toHaveText("$8,900.00");

  const brightonPlumb = page.locator("td[data-vendor='Brighton Electric'][data-line='PLB-SHOWER']");
  const brightonGlass = page.locator("td[data-vendor='Brighton Electric'][data-line='BATH-GLASS']");
  await brightonPlumb.getByLabel("Leave open PLB-SHOWER Brighton Electric").check();
  await brightonPlumb.getByRole("button", { name: "Plug" }).click();
  await expect(page.locator("th[data-vendor='Brighton Electric'] [data-incomplete]")).toBeVisible();
  await brightonGlass.getByLabel("Leave open BATH-GLASS Brighton Electric").check();
  await brightonGlass.getByRole("button", { name: "Plug" }).click();
  await expect(page.locator("th[data-vendor='Brighton Electric'] [data-incomplete]")).toHaveCount(0);

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/bids/bid_ok_valve");
  await expect(page.locator("[data-leveled]")).toHaveCount(0);
  await expect(page.locator("[data-incomplete]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$8,900.00");
  await expect(page.locator("body")).not.toContainText("$3,600.00");
  await expect(page.locator("body")).not.toContainText("Glass allowance");
});

test.describe("bid portal on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("creates a bid, collects prices, and awards draft purchase orders", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await createAndAward(page);
  });
});
