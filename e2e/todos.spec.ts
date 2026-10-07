import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
}

test.describe("to-dos on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("creates a checklist, shifts a linked to-do, and keeps WIP red readable", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await expect(page.getByRole("link", { name: "Overdue to-dos" })).toBeVisible();
    await page.goto("/todos");
    await expect(page.getByRole("heading", { name: "To-dos" })).toBeVisible();
    await page.getByRole("link", { name: "New" }).click();
    const sheet = page.getByRole("dialog", { name: "New to-do" });
    await sheet.getByLabel("Title").fill("Cabinet delivery");
    await sheet.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
    await sheet.getByLabel("Checklist").fill("Measure the niche\nOrder the trim");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Cabinet delivery" })).toBeVisible();
    await expect(page.getByText("0/2").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "Measure the niche" }).click();
    await expect(page.getByText("1/2").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "Order the trim" }).click();
    await expect(page.getByRole("button", { name: "Mark to-do done" })).toBeVisible();
    const pane = page.getByRole("complementary", { name: "To-do" });
    await expect(pane).toHaveAttribute("data-status", "open");
    await page.goto("/todos?task=task_walk");
    const before = await pane.getAttribute("data-due");
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "todos-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "todos-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/schedule");
    await page.getByRole("button", { name: /Okonkwo primary bath Tile shower/ }).first().click();
    const item = page.getByRole("dialog", { name: "Schedule item" });
    const end = item.getByLabel("End");
    const current = await end.inputValue();
    const later = new Date(`${current}T12:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 7);
    await end.fill(later.toISOString().slice(0, 10));
    await item.getByRole("button", { name: "Save" }).click();
    await expect(item.getByRole("status")).toHaveText(/Moves [2-9] items/);
    await item.getByRole("button", { name: /Moves [2-9] items/ }).click();
    await page.goto("/todos?task=task_walk");
    await expect(page.getByRole("complementary", { name: "To-do" })).not.toHaveAttribute("data-due", before || "");
    await page.goto("/reports/wip");
    await page.getByRole("cell", { name: "-$16,800" }).click();
    await expect(page.getByRole("row", { name: /Brooks powder room/ })).toHaveClass(/is-selected/);
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "wip-selected-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "wip-selected-dark");
  });
});

test.describe("to-dos on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("lets a field lead tick an assigned item", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
    await page.goto("/todos");
    await expect(page.getByRole("link", { name: /Pre-drywall walk/ })).toBeVisible();
    await expect(page.getByText("Collect the Diaz final invoice")).toHaveCount(0);
    await page.getByRole("link", { name: /Pre-drywall walk/ }).click();
    await expect(page.getByRole("checkbox", { name: "Blocking in place" })).toHaveCount(0);
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "todos-field-phone");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "todos-field-phone-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("checkbox", { name: "Water lines capped" }).click();
    await expect(page.getByRole("checkbox", { name: "Water lines capped" })).toBeChecked();
  });
});

test.describe("vendor to-dos", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lets a vendor tick their item and attach a photo", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
    await expect(page.getByRole("heading", { name: "To-dos" })).toBeVisible();
    await expect(page.getByText("Water lines capped")).toHaveCount(0);
    await expect(page.locator("[data-todo]")).not.toContainText("$");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Photo Blocking in place").setInputFiles({ name: "cap.png", mimeType: "image/png", buffer: png });
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "todos-vendor");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "todos-vendor-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("checkbox", { name: "Blocking in place" }).click();
    await expect(page.getByRole("checkbox", { name: "Blocking in place" })).toBeChecked();
  });
});
