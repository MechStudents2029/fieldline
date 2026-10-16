import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

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

test("create a form, fill the link, review it, and export CSV", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(page, "maya@rivera.demo");
  await revealToday(page, "Forms");
  await expect(page.locator("a:visible", { hasText: "Forms" })).toContainText("1");

  await page.goto("/settings/forms");
  await page.getByLabel("Title").fill("Closeout notes");
  await page.getByLabel("Description").fill("After the walk");
  await page.getByRole("checkbox", { name: "Client" }).check();
  await page.getByLabel("Field label", { exact: true }).fill("Notes");
  await page.getByLabel("Required", { exact: true }).check();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Closeout notes" })).toBeVisible();
  const link = await page.getByLabel("Fill link").inputValue();
  expect(link).toContain("/forms/fill/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /Rivera/ })).toBeVisible();
  await page.getByLabel("Notes").fill("Gate latched");
  await page.waitForTimeout(3200);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Received.")).toBeVisible();

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/inbox");
  await page.getByRole("link", { name: /Closeout notes/ }).first().click();
  await expect(page.locator("[data-status='new']")).toBeVisible();
  await expect(page.getByText("Gate latched")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "forms-submission-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "forms-submission-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.locator("[data-status='reviewed']")).toBeVisible();

  await page.goto("/");
  await revealToday(page, "Forms");
  await expect(page.locator("a:visible", { hasText: "Forms" })).toContainText("1");

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/forms?template=&status=");
    return { status: response.status, body: await response.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.body).toContain("Gate latched");
  expect(csv.body).toContain("Harbor Electric");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/forms");
  await expect(page.getByRole("table", { name: "Form submissions" }).getByRole("link", { name: "Site walkthrough" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vendor info update" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Closeout notes" })).toHaveCount(0);
  await page.goto("/settings/forms");
  await expect(page.getByLabel("Title")).toHaveCount(0);

  await signInAs(page, "luis@rivera.demo");
  await page.goto("/settings/forms/ft_walk");
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(page.getByLabel("Fill link")).toBeVisible();
});
