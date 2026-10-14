import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
}

async function pair(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, name);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, `${name}-dark`);
  await page.emulateMedia({ colorScheme: "light" });
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

test("credit memos list, apply, and a field draft", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await revealToday(page, "Credit memos");
  await expect(page.locator('a[href="/credit-memos?attention=1"]:visible')).toBeVisible();
  await page.goto("/credit-memos");
  await expect(page.getByRole("link", { name: "CM-1048" })).toBeVisible();
  await expect(page.getByRole("link", { name: "CM-1049" })).toBeVisible();
  await expect(page.getByText("$180.00").first()).toBeVisible();
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/credit-memos");
    return response.text();
  });
  expect(csv).toContain("CM-1048");
  expect(csv).toContain("Window allowance");
  await pair(page, "credit-memos-list");
  await page.goto("/credit-memos/ccm_open");
  await expect(page.getByRole("heading", { name: "CM-1048" })).toBeVisible();
  await expect(page.getByText("Ready").first()).toBeVisible();
  await pair(page, "credit-memos-detail");
  await page.getByLabel("Invoice").selectOption({ label: "RR-1036" });
  await page.getByLabel("Apply amount").fill("50");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status")).toContainText("Applied");
  await page.goto("/invoices/inv_br_prog");
  await expect(page.getByRole("heading", { name: "RR-1036" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payments" })).toContainText("Credit memo");
  await pair(page, "credit-memo-invoice");
  await page.goto("/portal/demo_portal_brooks");
  await expect(page.getByRole("region", { name: "Credit memos" })).toContainText("CM-1048");
  await expect(page.getByRole("region", { name: "Invoices" })).toContainText("Credit memo");
  const contract = page.getByRole("region", { name: "Money" });
  await expect(contract).toContainText("Credits");
  await signInAs(page, "dana@rivera.demo");
  await page.goto("/credit-memos");
  await expect(page.getByRole("link", { name: "CM-1048" })).toHaveCount(0);
  await expect(page.getByText("$180.00")).toHaveCount(0);
  await page.getByLabel("Title").fill("Touch-up credit");
  await page.getByLabel("Description").fill("Hall scuff");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await expect(page.getByRole("link", { name: /CM-/ })).toBeVisible();
});
