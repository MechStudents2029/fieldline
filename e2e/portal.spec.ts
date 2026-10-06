import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

async function reviewPortal(page: Page) {
  await page.goto("/portal/demo_portal_okonkwo");
  await expect(page.getByRole("heading", { name: "Okonkwo primary bath" })).toBeVisible();
  const money = page.getByRole("region", { name: "Money" });
  await expect(money.getByText("Contract")).toBeVisible();
  await expect(money.getByText("Paid")).toBeVisible();
  await expect(money.getByText("Balance")).toBeVisible();
  await expect(money.getByText("$46,200.00")).toBeVisible();
  await expect(money.getByText("$16,800.00")).toBeVisible();
  await expect(money.getByText("$29,400.00")).toBeVisible();

  const needs = page.getByRole("region", { name: "Needs you" });
  await expect(needs).toBeVisible();
  await needs.getByLabel("Type your name").fill("Amara Okonkwo");
  await needs.getByRole("checkbox", { name: /By signing/ }).check();
  await needs.getByRole("button", { name: "Approve change order" }).click();
  await expect(page.getByRole("button", { name: "Approve change order" })).toHaveCount(0);
  await expect(page.getByText("Awaiting approval")).toHaveCount(0);
  await expect(page.getByText("$47,160.00")).toBeVisible();

  const invoice = page.getByRole("article").filter({ hasText: "RR-1038" });
  await invoice.getByRole("link", { name: "Pay", exact: true }).click();
  await expect(page).toHaveURL(/\/pay\/demo_pay_okonkwo_progress/);
  await expect(page.getByRole("button", { name: "Pay by ACH" })).toBeVisible();

  await page.goto("/portal/demo_portal_okonkwo");
  await page.getByRole("button", { name: "Shower substrate" }).click();
  const dialog = page.getByRole("dialog", { name: "Photo" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("homeowner portal at 1440", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await reviewPortal(page);
});

test.describe("phone portal", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("homeowner portal on a phone", async ({ page, request }) => {
    await resetDemo(request);
    await reviewPortal(page);
  });
});
