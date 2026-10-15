import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

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

async function shotLocator(page: Page, selector: string, name: string) {
  const buffer = await page.locator(selector).screenshot();
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

test("shows the 2026 1099 rollup and a role-gated CSV", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetDemo(request);
  await signInAs(page, "maya@rivera.demo");
  await expect(page.getByRole("link", { name: "W-9" })).toHaveCount(0);
  await page.goto("/inbox");
  await expect(page.locator("body")).not.toContainText("1099 W-9");
  await page.goto("/reports");
  await expect(page.getByRole("table").getByRole("link", { name: "1099" })).toBeVisible();
  await page.goto("/reports/nec?year=2026");
  await expect(page.getByRole("heading", { name: "1099" })).toBeVisible();
  await page.getByLabel("Year").selectOption("2026");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/year=2026/);

  const harbor = page.locator("tr[data-vendor='Harbor Plumbing']");
  const casa = page.locator("tr[data-vendor='Casa Tile']");
  const brighton = page.locator("tr[data-vendor='Brighton Electric']");
  await expect(harbor).toHaveAttribute("data-over", "1");
  await expect(harbor).toHaveAttribute("data-w9", "on_file");
  await expect(casa).toHaveAttribute("data-over", "1");
  await expect(casa).toHaveAttribute("data-w9", "on_file");
  await expect(brighton).toHaveAttribute("data-w9", "missing");
  await expect(page.locator("tr[data-vendor='Summit Lumber']")).toHaveAttribute("data-over", "0");
  await expect(page.locator("tr[data-vendor='Mill & Co Cabinets']")).toHaveAttribute("data-exempt", "1");
  await expect(page.locator("tr[data-vendor='Slab House']")).toHaveAttribute("data-card", "1");
  await expect(page.locator("tr[data-vendor='Slab House']")).toHaveAttribute("data-box1", "0");
  await expect(page.locator("body")).not.toContainText("34-5678901");
  await expect(page.locator("body")).toContainText("••••8901");

  const needs = page.getByRole("table", { name: "Needs W-9" });
  await expect(needs.locator("tr[data-needs='Brighton Electric']")).toBeVisible();
  await expect(needs.getByRole("button", { name: "Copy portal link" })).toHaveAttribute("data-portal", /demo_vendor_brighton_k4n2p9qx/);
  await shot(page, "nec-report-light");
  await shotLocator(page, "table[aria-label='Needs W-9']", "nec-needs-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "nec-report-dark");
  await shotLocator(page, "table[aria-label='Needs W-9']", "nec-needs-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await needs.getByRole("button", { name: "Mark requested" }).click();
  await expect(needs.locator(".fl-pill", { hasText: "Requested" })).toBeVisible();
  await expect(needs.getByRole("button", { name: "Mark requested" })).toHaveCount(0);

  const [ownerDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
  expect(ownerDownload.suggestedFilename()).toBe("fieldline-1099-2026.csv");
  const owner = fs.readFileSync(await ownerDownload.path(), "utf8");
  expect(owner.split("\n")[0]).toBe("Year,Legal name,TIN,Address,Box 1");
  expect(owner).toContain("12-3456789");
  expect(owner).toContain("34-5678901");
  expect(owner).toContain("2500.00");
  expect(owner).not.toContain("Slab House");

  await signInAs(page, "luis@rivera.demo");
  await page.goto("/reports/nec?year=2026");
  const [officeDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
  const office = fs.readFileSync(await officeDownload.path(), "utf8");
  expect(office).toContain("Harbor Plumbing LLC");
  expect(office).not.toContain("12-3456789");
  expect(office).not.toMatch(/\d{2}-\d{7}/);

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/reports/nec?year=2026");
  await expect(page.getByRole("table", { name: "1099" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("$3,200.00");
  await expect(page.locator("body")).not.toContainText("••••6789");
});
