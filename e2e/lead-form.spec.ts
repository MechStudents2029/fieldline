import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

const FORM = "/f/demo_form_rivera_k7m2p9qx";

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

test("office lead form at 1440", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  const framed = await request.get(FORM);
  expect(framed.headers()["content-security-policy"] ?? "").toContain("frame-ancestors");
  expect(framed.headers()["x-frame-options"] ?? "").toBe("");

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/settings");
  await page.getByRole("link", { name: "Lead form" }).click();
  await expect(page.getByRole("heading", { name: "Lead form" })).toBeVisible();
  await page.getByLabel("Accept requests").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  const link = await page.getByLabel("Public link").inputValue();
  expect(link).toContain(FORM);
  await expect(page.getByLabel("Embed")).toHaveValue(new RegExp("iframe"));

  await page.goto(link);
  await expect(page.getByText("Not taking requests.")).toBeVisible();

  await page.goto("/settings/lead-form");
  await page.getByLabel("Accept requests").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goto(`${link}${link.includes("?") ? "&" : "?"}source=yard-sign`);
  await expect(page.getByRole("heading", { name: /Rivera/ })).toBeVisible();
  await page.getByLabel("Name").fill("Casey Ng");
  await page.getByLabel("Email").fill("casey.ng.leadform@example.com");
  await page.getByLabel("Project type").selectOption("Kitchen remodel");
  await page.getByLabel("Budget").selectOption("$25–50k");
  await page.getByLabel("Description").fill("Kitchen, about 120 sq ft.");
  await page.waitForTimeout(3200);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks. We'll be in touch.")).toBeVisible();

  await page.goto("/");
  const row = page.locator("a:visible", { hasText: "New web leads" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("2");
  await row.click();
  await expect(page.getByLabel("Source").locator("option", { hasText: "Website form" })).toHaveCount(1);
  await page.getByRole("link", { name: "Casey Ng Kitchen remodel" }).click();
  await expect(page.getByText("Website form").first()).toBeVisible();
  await expect(page.getByText("$25–50k")).toBeVisible();
  await expect(page.getByText("120 sq ft")).toBeVisible();
  await expect(page.getByText("source yard-sign")).toBeVisible();
});

test.describe("phone lead form", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("homeowner sends a request", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto(FORM);
    await expect(page.getByRole("heading", { name: /Rivera/ })).toBeVisible();
    await page.getByLabel("Name").fill("Jules Park");
    await page.getByLabel("Phone").fill("5105550171");
    await page.waitForTimeout(3200);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thanks. We'll be in touch.")).toBeVisible();
  });
});
