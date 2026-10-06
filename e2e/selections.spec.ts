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

test("office selections at 1440", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible", { hasText: "Floor tile" })).toHaveCount(1);
  await page.goto("/projects/proj_okonkwo/selections");
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Floor tile/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Vanity/ })).toContainText("Quartz vanity");
  await expect(page.getByText("$8,000").first()).toBeVisible();
  await expect(page.getByText("$6,200").first()).toBeVisible();

  await page.getByRole("button", { name: "Add" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Mirror");
  await dialog.getByLabel("Area").fill("Bath");
  await dialog.getByLabel("Choice 1 name").fill("Round mirror");
  await dialog.getByLabel("Choice 1 price").fill("180");
  await dialog.getByLabel("Choice 1 cost").fill("90");
  await dialog.getByLabel("Choice 2 name").fill("Wide mirror");
  await dialog.getByLabel("Choice 2 price").fill("240");
  await dialog.getByLabel("Choice 2 cost").fill("110");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(table.getByRole("row", { name: /Mirror/ })).toContainText("Draft");

  await table.getByRole("button", { name: "Open Mirror" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Release" }).click();
  await expect(table.getByRole("row", { name: /Mirror/ })).toContainText("Released");

  await table.getByRole("button", { name: "Open Mirror" }).click();
  await page.getByRole("dialog").getByLabel("Note").fill("by phone");
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(table.getByRole("row", { name: /Mirror/ })).toContainText("Chosen");

  await table.getByRole("button", { name: "Open Mirror" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Draft change order for +$180" }).click();
  await expect(table.getByRole("row", { name: /Mirror/ })).toContainText("CO draft");

  await page.getByRole("button", { name: "Sign out" }).click();
  await signInAs(page, "dana@rivera.demo");
  await page.goto("/projects/proj_okonkwo/selections");
  await expect(page.getByRole("table").getByRole("row", { name: /Floor tile/ })).toBeVisible();
  await expect(page.getByRole("table").getByText("Quartz vanity")).toBeVisible();
  await expect(page.getByText("$")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await signInAs(page, "jordan@northline.demo");
  await page.goto("/projects/proj_okonkwo/selections");
  await expect(page.getByRole("heading", { name: "Not in this company" })).toBeVisible();
});

test.describe("homeowner selections", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("homeowner chooses a tile", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto("/portal/demo_portal_okonkwo");
    const selections = page.getByRole("region", { name: "Selections" });
    await expect(selections.getByText("Floor tile", { exact: true })).toBeVisible();
    await expect(selections.getByText("+$600")).toBeVisible();
    await expect(selections.getByText("Quartz vanity")).toBeVisible();
    await selections.getByRole("radio", { name: "Honed marble" }).check();
    await selections.getByLabel("Type your name").fill("Amara Okonkwo");
    await selections.getByRole("checkbox").check();
    await selections.getByRole("button", { name: "Confirm Floor tile" }).click();
    await expect(selections.getByText("Honed marble")).toBeVisible();
    await expect(selections.getByLabel("Type your name")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Money" }).getByText("$46,200.00")).toBeVisible();
  });
});
