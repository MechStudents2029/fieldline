import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

function todayInNewYork() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** A workday inside the week the schedule is showing. Saturday and Sunday snap onto Friday. */
function scheduleStart() {
  const day = todayInNewYork();
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const back = weekday === 6 ? 1 : weekday === 0 ? 2 : 0;
  return new Date(Date.UTC(year, month - 1, date - back)).toISOString().slice(0, 10);
}

test.describe("templates and dependencies", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("creates a job from a template and previews a cascade", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bathroom remodel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kitchen remodel" })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "templates-list-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "templates-list-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("button", { name: "New job" }).click();
    const sheet = page.getByRole("dialog", { name: "New job" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Job").fill("Template bath");
    await sheet.getByLabel("Client").selectOption({ label: "Amara Okonkwo" });
    await sheet.getByLabel("Start").fill(scheduleStart());
    await sheet.getByLabel("PM").selectOption({ label: "Maya Rivera" });
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "template-new-job-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "template-new-job-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await sheet.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name: "Template bath" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(/Created \d+ items/);
    await expect(page.getByText("Bathroom remodel v1").filter({ visible: true })).toBeVisible();
    await page.goto("/schedule");
    await page.getByRole("button", { name: /Template bath Demo/ }).first().click();
    const item = page.getByRole("dialog", { name: "Schedule item" });
    const end = item.getByLabel("End");
    const current = await end.inputValue();
    const later = new Date(`${current}T12:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 7);
    await end.fill(later.toISOString().slice(0, 10));
    await item.getByRole("button", { name: "Save" }).click();
    await expect(item.getByRole("status")).toHaveText(/Moves \d+ items/);
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "schedule-cascade-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "schedule-cascade-dark");
    await item.getByRole("button", { name: /Moves \d+ items/ }).click();
    await expect(page.getByRole("button", { name: /Template bath Demo/ }).first()).toBeVisible();
  });
});

test.describe("templates on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("creates a job and cascades a schedule item", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/templates?new=1");
    const sheet = page.getByRole("dialog", { name: "New job" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Job").fill("Phone bath");
    await sheet.getByLabel("Client").selectOption({ label: "Amara Okonkwo" });
    await sheet.getByLabel("Start").fill(scheduleStart());
    await sheet.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("status")).toHaveText(/Created \d+ items/);
    await expect(page.getByText("Bathroom remodel v1").filter({ visible: true })).toBeVisible();
    await page.goto("/schedule");
    await page.getByRole("link", { name: /Phone bath/ }).first().click();
    await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
    const end = page.getByLabel("End");
    const current = await end.inputValue();
    const later = new Date(`${current}T12:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 5);
    await end.fill(later.toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(/Moves \d+ items/);
    await page.getByRole("button", { name: /Moves \d+ items/ }).click();
    await expect(page.getByRole("status")).toHaveText(/Moves \d+ items/);
  });
});
