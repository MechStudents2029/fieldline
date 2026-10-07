import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const harbor = "/v/demo_vendor_harbor_m3p8qx7k";

async function signBackIn(page: Page) {
  await page.goto("/login");
  const field = page.getByLabel("Email");
  if (!(await field.isVisible().catch(() => false))) {
    await page.goto("/more");
    await page.locator("#main").getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }
  await signIn(page);
}

async function officeVendorClientClose(page: Page) {
  await expect(page.locator("a:visible", { hasText: "RFIs overdue" })).toBeVisible();
  await page.goto("/projects/proj_okonkwo");
  const width = page.viewportSize()?.width ?? 1440;
  const form = page.getByRole("region", { name: "RFIs" });
  await form.getByRole("button", { name: "New RFI" }).click();
  await form.getByLabel("RFI title").fill("E2E hinge");
  await form.getByLabel("Question").fill("Is the hinge still the brushed one?");
  await form.getByLabel("RFI due").fill("2026-12-15");
  await form.getByLabel("Assignee").selectOption({ label: "Amara Okonkwo" });
  await page.getByRole("button", { name: "Create RFI" }).click();
  await expect(page.getByText("Added.")).toBeVisible();
  if (width >= 768) {
    await expect(page.getByRole("table", { name: "RFI log" })).toContainText("E2E hinge");
    await expect(page.getByRole("table", { name: "RFI log" })).toContainText("RFI-004");
  } else {
    await expect(page.getByRole("list", { name: "RFI list" })).toContainText("E2E hinge");
  }
  await page.goto(harbor);
  const vendor = page.locator("[data-rfi='Valve height']");
  await expect(vendor).toBeVisible();
  await expect(page.getByRole("region", { name: "RFIs" })).not.toContainText("Vanity quartz");
  await vendor.getByLabel("Answer Valve height").fill("42 inches to the center.");
  await vendor.getByRole("button", { name: "Send answer" }).click();
  await expect(vendor.getByText("Answered", { exact: true })).toBeVisible();

  await page.goto("/portal/demo_portal_okonkwo");
  const client = page.locator("[data-rfi='E2E hinge']");
  await expect(client).toBeVisible();
  await expect(page.getByRole("region", { name: "RFIs" })).not.toContainText("Valve height");
  await client.getByLabel("Answer E2E hinge").fill("Yes, keep the brushed hinge.");
  await client.getByRole("button", { name: "Send answer" }).click();
  await expect(client.getByText("Answered", { exact: true })).toBeVisible();

  await signBackIn(page);
  await page.goto("/projects/proj_okonkwo");
  await page.locator("a:visible", { hasText: "E2E hinge" }).click();
  await page.getByLabel("Cost impact").check();
  await page.getByLabel("Cost amount").fill("250");
  await page.getByRole("button", { name: "Close RFI" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Draft change order" }).click();
  await expect(page.getByText(/CO \d+/)).toBeVisible();
}

test("office creates an RFI, portals answer, and close drafts a change order at 1440", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await officeVendorClientClose(page);
});

test.describe("RFIs on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("field layout creates an RFI and the portals answer it", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await officeVendorClientClose(page);
  });
});
