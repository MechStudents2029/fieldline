import { devices, expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const phone = {
  viewport: { width: 393, height: 852 },
  userAgent: devices["iPhone 13"].userAgent,
  deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
};

test("desktop keeps the sidebar and the light grouped background", async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await resetDemo(request);
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Office" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Pipeline", exact: true })).toBeVisible();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(242, 242, 247)");
});

test.describe("phone shell", () => {
  test.use(phone);

  test("office tabs open Today and Jobs", async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await resetDemo(request);
    await signIn(page);
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs.getByRole("link", { name: "Today" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Jobs" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Leads" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Time" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "More" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await tabs.getByRole("link", { name: "Jobs" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Okonkwo primary bath/ })).toBeVisible();
  });

  test("field tabs omit Leads and More still opens Pipeline", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto("/login");
    await page.getByLabel("Email").fill("dana@rivera.demo");
    await page.getByLabel("Password").fill("demo");
    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs.getByRole("link", { name: "My day" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Leads" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "More" }).click();
    await expect(page.getByRole("link", { name: "Pipeline", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Purchase orders", exact: true })).toHaveCount(0);
  });

  test("dark mode uses the black grouped background", async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await resetDemo(request);
    await signIn(page);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe("rgb(0, 0, 0)");
  });
});
