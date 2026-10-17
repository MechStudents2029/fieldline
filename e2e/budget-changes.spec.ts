import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

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

test("moves budget dollars and funds a change from contingency", async ({ page }) => {
  await resetDemo(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Budget age");
  await expect(page.locator("a:visible", { hasText: "Budget age" })).toContainText("1");
  await revealToday(page, "Low contingency");
  await expect(page.locator("a:visible", { hasText: "Low contingency" })).toContainText("1");

  await page.goto("/projects/proj_chen");
  const contingency = page.locator("tr[data-code='GC-CONT']");
  await expect(contingency.locator("[data-kind=budget]")).toHaveText("$1,000");
  await expect(contingency.locator("[data-kind=changes]")).toHaveText("-$800");
  await expect(contingency.locator("[data-kind=revised]")).toHaveText("$200");
  await expect(page.locator("[data-contingency]").first()).toHaveText("$200");

  await page.goto("/budget-changes/bc_chen_xfer");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".fl-pill[data-status=approved]")).toBeVisible();

  await page.goto("/projects/proj_chen");
  const demo = page.locator("tr[data-code='DEMO-GUT']");
  await expect(demo.locator("[data-kind=budget]")).toHaveText("$700");
  await expect(demo.locator("[data-kind=revised]")).toHaveText("$600");

  await page.goto("/projects/proj_chen/changes");
  await page.getByLabel("Title").fill("E2E contingency fix");
  await page.getByLabel("Cost code").fill("GC-SUPER");
  await page.getByLabel("ROM cost").fill("100");
  await page.getByRole("button", { name: "Log" }).click();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await page.getByRole("button", { name: "Fund from contingency", exact: true }).click();
  await expect(page.locator(".fl-pill[data-status=draft]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E contingency fix" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".fl-pill[data-status=approved]")).toBeVisible();
  await page.locator("[data-event]").click();
  await expect(page.locator(".fl-pill[data-status=converted]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fund from contingency", exact: true })).toHaveCount(0);

  await page.goto("/budget-changes");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/budget-changes");
    return response.text();
  });
  expect(csv).toContain("E2E contingency fix");
  expect(csv).toContain("Tile shift");

  await page.goto("/portal/demo_portal_chen");
  await expect(page.getByText("Supervision cover")).toHaveCount(0);
  await expect(page.getByText("Tile shift")).toHaveCount(0);
  await expect(page.getByText("GC-CONT")).toHaveCount(0);
  await expect(page.getByText("E2E contingency fix")).toHaveCount(0);

  await signInAs(page, "dana@rivera.demo");
  const hidden = await page.goto("/budget-changes");
  expect(hidden?.status()).toBe(404);
});
