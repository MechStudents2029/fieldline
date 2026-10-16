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

test("publish a spec from the budget and keep the prior version", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(page, "maya@rivera.demo");
  await revealToday(page, "Spec due");
  await expect(page.locator("a:visible", { hasText: "Spec due" })).toContainText("1");

  await page.goto("/projects/proj_chen/specs");
  await page.getByLabel("Spec title").fill("Chen specs");
  await page.getByRole("button", { name: "From budget" }).click();
  await expect(page.getByText("Vanity and top")).toBeVisible();
  await page.getByLabel("Notes Vanity and top").fill("Quartz top");
  await page.getByRole("button", { name: "Save Vanity and top" }).click();
  await expect(page.getByText("Quartz top")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator("[data-status='published']")).toBeVisible();
  const link = await page.getByLabel("Link").inputValue();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(link);
  await expect(page.getByText("Vanity and top")).toBeVisible();
  await expect(page.getByText("Quartz top")).toBeVisible();
  await expect(page.getByText("Draft only canopy")).toHaveCount(0);
  await expect(page.getByText("$")).toHaveCount(0);

  await page.goto("/spec/demo_spec_ok_a1");
  await expect(page.getByRole("link", { name: "a101-floor-plan.pdf" })).toBeVisible();
  await expect(page.getByText("Shower niche, tiled")).toBeVisible();

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/projects/proj_chen/specs");
  await page.getByRole("link", { name: "Chen specs" }).click();
  await page.getByRole("button", { name: "Revise" }).click();
  await expect(page.locator("[data-version='2']")).toBeVisible();
  await page.getByLabel("New line").fill("Draft only canopy");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("Draft only canopy")).toBeVisible();
  await expect(page.locator("[data-history='1']")).toBeVisible();

  await page.goto(link);
  await expect(page.getByText("Vanity and top")).toBeVisible();
  await expect(page.getByText("Draft only canopy")).toHaveCount(0);
  await expect(page.locator("[data-version='1']")).toBeVisible();

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/specs/spec_br_frame");
  await expect(page.getByText("Budget changed")).toBeVisible();
  await expect(page.getByText("2x6 exterior.")).toBeVisible();
  await page.getByRole("button", { name: "Keep Framing" }).click();
  await expect(page.getByText("Budget changed")).toHaveCount(0);
  await expect(page.getByText("2x6 exterior.")).toBeVisible();

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/specs");
    return `${response.status}\n${await response.text()}`;
  });
  expect(csv.startsWith("200")).toBeTruthy();
  expect(csv).toContain("Shower niche, tiled");
  expect(csv).toContain("Vanity and top");
});
