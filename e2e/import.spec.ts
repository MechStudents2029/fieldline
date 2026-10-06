import { devices, expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

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

test.describe("import wizard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("pastes, maps, reviews, imports, and undoes", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/import");
    await page.getByRole("textbox", { name: "CSV" }).fill("Display Name,Email,Phone\nNora Import,nora.import.e2e@example.com,5105550198");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("table").getByLabel("Display Name column")).toHaveValue("name");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText("1 new", { exact: true })).toBeVisible();
    await expect(page.getByRole("table").getByText("New", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.goto("/contacts");
    await expect(page.getByRole("link", { name: "Nora Import" })).toBeVisible();
    await page.goto("/import");
    await page.getByRole("button", { name: "Undo" }).click();
    await page.goto("/contacts");
    await expect(page.getByRole("link", { name: "Nora Import" })).toHaveCount(0);
  });
});

test.describe("phone import", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("shows the import form", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "CSV" })).toBeVisible();
  });
});
