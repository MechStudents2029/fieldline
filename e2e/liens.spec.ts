import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday } from "./helpers";

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

test("prints an at-risk notice and marks it sent", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetDemo(page.request);
  await signInAs(page, "maya@rivera.demo");
  await revealToday(page, "Liens");
  await expect(page.locator("a:visible").filter({ hasText: "Liens" }).filter({ hasText: "1" })).toBeVisible();

  await page.goto("/projects/proj_lien_tx");
  await expect(page.locator("[data-lien]")).toHaveAttribute("data-status", "at-risk");
  await page.goto("/projects/proj_lien_tx/lien/prelim/print");
  await expect(page.getByRole("heading", { name: "Owen Hale" })).toBeVisible();
  await expect(page.getByText("$860.00")).toBeVisible();

  await page.goto("/projects/proj_lien_tx");
  const deadline = await page.locator("[data-lien]").getAttribute("data-deadline");
  await page.getByLabel("Sent").fill(deadline || "");
  await page.getByLabel("Method").selectOption("certified");
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.locator("[data-lien]")).toHaveAttribute("data-status", "protected");

  await page.goto("/");
  await expect(page.locator("a:visible").filter({ hasText: "Liens" }).filter({ hasText: "1" })).toHaveCount(0);

  await page.goto("/liens?status=protected&state=TX");
  await expect(page.locator("[data-job='proj_lien_tx']")).toHaveAttribute("data-status", "protected");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/liens?state=TX");
    return { status: response.status, text: await response.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.text).toContain("Hale warehouse");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/liens");
  await expect(page.getByRole("table", { name: "Lien deadlines" })).toHaveCount(0);
  const denied = await page.evaluate(async () => {
    const response = await fetch("/api/export/liens");
    return response.status;
  });
  expect(denied).not.toBe(200);
});
