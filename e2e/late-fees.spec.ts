import { expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

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

async function csv(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/export/ar");
    return { status: response.status, text: await response.text() };
  });
}

test("sets a late-fee policy, reviews a fee, and prints a statement", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetDemo(page.request);
  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible").filter({ hasText: "Fees" }).filter({ hasText: "$27.00" })).toBeVisible();

  await page.goto("/p/demo_proposal_briggs");
  await expect(page.locator("[data-late-policy]")).toHaveText("$25.00 + 1.00% after 7 days");
  await page.goto("/pay/demo_pay_lf_applied");
  await expect(page.getByText("Late fee")).toBeVisible();
  await expect(page.getByText("$28.00")).toBeVisible();
  await page.goto("/portal/demo_portal_brooks");
  await expect(page.locator("[data-late-policy]")).toHaveText("$25.00 + 1.00% after 7 days");
  await expect(page.locator("[data-late-fee]")).toContainText("$28.00");

  await page.goto("/settings/billing");
  await page.getByLabel("Flat").fill("30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.locator("[data-late-policy]")).toHaveText("$30.00 + 1.00% after 7 days");

  await page.goto("/fees/lf_pending");
  await expect(page.locator("[data-fee-detail]")).toHaveAttribute("data-status", "pending");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status")).toHaveText("Applied.");
  await page.reload();
  await expect(page.locator("[data-fee-detail]")).toHaveAttribute("data-status", "applied");
  await page.getByLabel("Reason").fill("Courtesy");
  await page.getByRole("button", { name: "Waive" }).click();
  await expect(page.getByRole("status")).toHaveText("Waived.");
  await page.reload();
  await expect(page.locator("[data-fee-detail]")).toHaveAttribute("data-status", "waived");
  await expect(page.locator("[data-reason]")).toHaveText("Courtesy");

  await page.goto("/fees/lf_waived");
  await expect(page.locator("[data-reason]")).toHaveText("Good customer.");
  await expect(page.getByRole("button", { name: "Waive" })).toHaveCount(0);

  await page.goto("/statements/stmt_brooks/print");
  await expect(page.getByRole("heading", { name: "Chris Brooks" })).toBeVisible();
  await expect(page.getByText("LF-2001")).toBeVisible();
  await page.goto("/statements/stmt_brooks");
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByRole("status")).toHaveText("Marked.");
  await page.reload();
  await expect(page.locator("[data-sent]")).toContainText("Maya Rivera");
  await page.goto("/s/demo_statement_brooks");
  await expect(page.getByRole("heading", { name: "Chris Brooks" })).toBeVisible();
  await expect(page.getByText("LF-2001")).toBeVisible();

  await page.goto("/reports/ar");
  await expect(page.getByRole("table", { name: "AR aging" })).toBeVisible();
  await expect(page.locator("[data-client='Chris Brooks']")).toBeVisible();
  const owner = await csv(page);
  expect(owner.status).toBe(200);
  expect(owner.text).toContain("Chris Brooks");
  expect(owner.text).toContain("1–30");
  expect(owner.text).toContain("90+");

  await signInAs(page, "riley@rivera.demo");
  await page.goto("/reports/ar");
  await expect(page.getByRole("table", { name: "AR aging" })).toBeVisible();
  await page.goto("/settings/billing");
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await page.goto("/fees/lf_applied");
  await expect(page.getByRole("button", { name: "Waive" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/reports/ar");
  await expect(page.getByRole("table", { name: "AR aging" })).toHaveCount(0);
  const field = await csv(page);
  expect(field.status).not.toBe(200);
});
