import { devices, expect, test, type Page } from "@playwright/test";
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

test.describe("schedule week", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("adds from the grid, edits in the sheet, and shows the conflict", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(page.getByText("Conflict").first()).toBeVisible();
    await expect(page.getByText(/\d+ conflicts?$/).first()).toBeVisible();
    await page.getByRole("button", { name: /Add Sam Patel/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Schedule item" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Job").selectOption({ label: "Chen powder room" });
    await sheet.getByLabel("Title").fill("Measure the niche");
    await sheet.getByRole("button", { name: "Save" }).click();
    const created = page.getByRole("button", { name: /Chen powder room Measure the niche/ });
    await expect(created).toBeVisible();
    await created.click();
    await expect(sheet.getByLabel("Title")).toHaveValue("Measure the niche");
    await sheet.getByLabel("Title").fill("Measure the vanity");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: /Chen powder room Measure the vanity/ })).toBeVisible();
    await expect(page.getByText("Conflict").first()).toBeVisible();
  });

  test("adds an item from the job page", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/projects/proj_brooks");
    await page.getByRole("link", { name: "Add schedule" }).click();
    const sheet = page.getByRole("dialog", { name: "Schedule item" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Job")).toHaveValue("proj_brooks");
    await sheet.getByLabel("Title").fill("Job file walk");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: /Brooks family room addition Job file walk/ })).toBeVisible();
    await page.goto("/projects/proj_brooks");
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(page.getByText("Job file walk")).toBeVisible();
  });
});

test.describe("my day schedule", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("shows tomorrow's job", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await expect(page.getByRole("heading", { name: "Tomorrow" })).toBeVisible();
    await expect(page.getByLabel("Tomorrow")).toContainText("Okonkwo primary bath");
  });
});
