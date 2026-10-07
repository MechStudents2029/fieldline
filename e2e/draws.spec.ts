import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

async function billAndProgress(page: Page) {
  await expect(page.getByRole("link", { name: /Ready to bill/ })).toBeVisible();
  await page.goto("/projects/proj_okonkwo/draws");
  const schedule = page.getByRole("table", { name: "Schedule" });
  await expect(schedule).toBeVisible();
  const tile = schedule.locator("tr", { hasText: "Tile set" });
  await expect(tile).toContainText("Ready to bill");
  await page.getByRole("button", { name: "Bill Tile set" }).click();
  await expect(page).toHaveURL(/\/pay\//);
  await page.goto("/projects/proj_okonkwo/draws");
  await expect(page.getByRole("table", { name: "Schedule" }).locator("tr", { hasText: "Tile set" })).toContainText("Invoiced");

  await page.goto("/projects/proj_brooks/draws");
  await expect(page.getByRole("table", { name: "Schedule of values" })).toBeVisible();
  await page.getByLabel("This period Framing").fill("100");
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page.getByRole("heading", { name: /Pay application/ })).toBeVisible();
  await expect(page.getByText("Framing")).toBeVisible();

  await page.goto("/portal/demo_portal_okonkwo");
  await expect(page.locator("[data-draw='Tile set']")).toContainText("Invoiced");
  await expect(page.getByRole("region", { name: "Money" }).getByText("$46,200.00")).toBeVisible();
  await page.goto("/portal/demo_portal_brooks");
  await expect(page.getByText("Retained")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pay applications" })).toContainText("Framing");
}

test("draw schedule and progress invoice at 1440", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await billAndProgress(page);
});

test.describe("draws on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("bills a draw and a progress invoice", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await billAndProgress(page);
  });
});
