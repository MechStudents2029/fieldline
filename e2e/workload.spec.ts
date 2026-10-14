import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EIO") throw error;
    return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
  });
}

test("workload shows booked hours, a cell, CSV, a capacity warning, and Today", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);

  await page.goto("/schedule/workload");
  await expect(page.getByRole("heading", { name: "Workload" })).toBeVisible();
  const dana = page.locator('[data-person="user_dana"][data-over="1"]').first();
  await expect(dana).toBeVisible();
  await expect(page.locator('[data-person="user_luis"][data-over="1"]')).toHaveCount(0);
  await dana.click();
  await expect(page.getByRole("heading", { name: "Dana Cho" })).toBeVisible();
  await expect(page.getByText("Shop load").first()).toBeVisible();

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/workload");
    return response.text();
  });
  expect(csv).toContain("person,role,week_start,booked_hours,capacity_hours,utilization_percent,over");
  expect(csv).toContain("Dana Cho");
  expect(csv).toContain("yes");
  await shot(page, "workload");

  await page.goto("/schedule");
  await page.getByRole("button", { name: /Add Dana Cho/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Schedule item" });
  await sheet.getByLabel("Title").fill("Extra load");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Dana Cho/ })).toContainText(/Dana Cho \d+(?:\.\d+)?h \/ \d+(?:\.\d+)?h/);
  await shot(page, "workload-warning");

  await page.goto("/");
  const today = page.locator("[data-workload-today]").filter({ visible: true }).first();
  await expect(today).toContainText("Dana Cho");
  await expect(today).toContainText("1");
  await today.click();
  await expect(page.getByRole("heading", { name: "Workload" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Workload" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Workload" })).toBeVisible();
});
