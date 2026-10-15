import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

async function shot(page: Page, name: string, target?: Locator) {
  const buffer = target ? await target.screenshot() : await page.screenshot();
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

test("logs a trip, approves it, and marks the miles reimbursed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetDemo(page.request);
  await signInAs(page, "dana@rivera.demo");
  const form = page.getByRole("region", { name: "Trip" });
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Date").fill("2026-04-08");
  await form.getByLabel("Miles").fill("10");
  await form.getByLabel("From").fill("Yard");
  await form.getByLabel("To").fill("Brooks");
  await form.getByLabel("Purpose").fill("Tile pickup");
  await form.getByLabel("Kind").selectOption("business");
  await page.emulateMedia({ colorScheme: "light" });
  await form.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, "mileage-capture-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "mileage-capture-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await form.getByRole("button", { name: "Submit" }).click();
  await page.waitForURL(/\/mileage\/mt_/);
  const tripUrl = page.url();
  await expect(page.locator("[data-trip-detail]")).toHaveAttribute("data-status", "submitted");
  await expect(page.locator("[data-trip-detail]")).toHaveAttribute("data-amount", "725");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await signInAs(page, "riley@rivera.demo");
  await page.goto(tripUrl);
  await expect(page.locator("[data-trip-detail]")).toHaveAttribute("data-purpose", "Tile pickup");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await signInAs(page, "maya@rivera.demo");
  await page.goto(tripUrl);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("[data-trip-detail]")).toHaveAttribute("data-status", "approved");
  await expect(page.locator("[data-trip-detail]")).toContainText("$7.25");
  await page.goto("/mileage");
  await expect(page.locator("[data-purpose='Tile pickup']")).toBeVisible();
  await expect(page.locator("[data-purpose='Lumber run']")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "mileage-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "mileage-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/reimbursements");
  const row = page.locator("[data-miles] li", { hasText: "Tile pickup" });
  await expect(row).toContainText("$7.25");
  await row.getByRole("button", { name: "Mark reimbursed" }).click();
  await expect(row).toContainText("Reimbursed");
  await expect(row).toContainText("Maya Rivera");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/mileage");
    return { ok: response.ok, status: response.status, text: await response.text() };
  });
  expect(csv.status, csv.text.slice(0, 200)).toBe(200);
  expect(csv.ok).toBeTruthy();
  const body = csv.text;
  expect(body).toContain("7.25");
  expect(body).toContain("Tile pickup");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/mileage");
  await expect(page.getByText("Client walk")).toHaveCount(0);
  await expect(page.getByText("Lumber run")).toBeVisible();
  await page.goto("/mileage/mt_dana_no");
  await expect(page.locator("[data-reject-note]")).toHaveText("Home to shop.");
  const own = await page.evaluate(async () => {
    const response = await fetch("/api/export/mileage");
    return { ok: response.ok, status: response.status, text: await response.text() };
  });
  expect(own.status, own.text.slice(0, 200)).toBe(200);
  const ownBody = own.text;
  expect(ownBody).toContain("Tile pickup");
  expect(ownBody).not.toContain("Maya Rivera");
  expect(ownBody).not.toContain("Client walk");
});
