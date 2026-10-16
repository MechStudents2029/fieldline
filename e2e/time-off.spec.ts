import { expect, test } from "@playwright/test";
import { resetDemo, revealToday } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
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

test("field requests time off, office approves, capacity drops, and payroll shows PTO", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(page, "maya@rivera.demo");
  await revealToday(page, "Time off due");
  await expect(page.locator("a:visible", { hasText: "Time off due" })).toContainText("1");

  await signInAs(page, "dana@rivera.demo");
  await page.getByLabel("Time off start").fill("2026-11-16");
  await page.getByLabel("Time off end").fill("2026-11-16");
  await page.getByLabel("Time off type").selectOption("vacation");
  await page.getByLabel("Time off note").fill("Shop day");
  await page.getByRole("button", { name: "Request" }).click();
  await expect(page.locator("[data-status='pending']").first()).toBeVisible();
  await page.goto("/time-off");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/time-off?status=pending");
  const row = page.locator("tr", { hasText: "Dana Cho" }).filter({ hasText: "2026-11-16" });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/time-off?status=approved");
  await expect(page.locator("tr", { hasText: "Dana Cho" }).filter({ hasText: "2026-11-16" }).locator("[data-status='approved']")).toBeVisible();

  await page.goto("/schedule/workload?on=2026-11-16");
  await expect(page.locator("[data-person='user_dana'][data-week='2026-11-16']")).toContainText("0h / 32h");

  await page.goto("/schedule?view=grid&on=2026-11-16");
  await page.getByRole("button", { name: "Add Unassigned 2026-11-16" }).click();
  const item = page.getByRole("dialog", { name: "Schedule item" });
  await item.getByLabel("Title").fill("E2E call");
  await item.getByLabel("Start time").fill("10:00");
  await item.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /E2E call/ })).toBeVisible();

  await page.goto("/dispatch?on=2026-11-16");
  await expect(page.getByRole("region", { name: "Dana Cho" }).locator("[data-out='1']")).toBeVisible();
  await page.getByRole("complementary", { name: "Open" }).getByRole("button", { name: "E2E call" }).click();
  const dialog = page.getByRole("dialog", { name: "E2E call" });
  await dialog.getByLabel("Start").fill("10:00");
  await dialog.getByLabel("End").fill("11:00");
  await dialog.getByLabel("Tech").selectOption({ label: "Dana Cho" });
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.locator("[data-notice]")).toContainText("Dana Cho is out");
  await expect(page.getByRole("region", { name: "Dana Cho" }).getByRole("button", { name: "E2E call" })).toBeVisible();

  await page.goto("/time?view=week&on=2026-11-16");
  const dana = page.getByRole("row", { name: /Dana Cho/ });
  await expect(dana).toContainText("8.0");
});
