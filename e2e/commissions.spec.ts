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

async function pair(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, name);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, `${name}-dark`);
  await page.emulateMedia({ colorScheme: "light" });
}

test("add a commission plan, read owed and paid, and mark one paid", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);

  await page.goto("/settings/commissions");
  await expect(page.getByRole("heading", { name: "Commissions" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Maya/ })).toContainText("Bath remodel 6%");
  await expect(page.getByRole("row", { name: /Luis/ })).toContainText("Gross profit");
  await page.getByLabel("Plan name").fill("Field");
  await page.getByLabel("Who").selectOption({ label: "Role · field" });
  await page.getByLabel("Basis").selectOption("contract");
  await page.getByLabel("Rate").fill("3");
  await page.getByLabel("Deposit").fill("50");
  await page.getByLabel("Start").fill("0");
  await page.getByLabel("Completion").fill("50");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status").last()).toContainText("Added");
  await expect(page.getByRole("row", { name: /Field/ })).toContainText("3%");
  await pair(page, "commissions-settings");

  await page.goto("/projects/proj_brooks/commissions");
  await expect(page.getByText("Unassigned 50%")).toBeVisible();

  await page.goto("/commissions");
  await expect(page.getByRole("heading", { name: "Commissions" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Okonkwo primary bath/ }).filter({ hasText: "Owed" }).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /Okonkwo primary bath/ }).filter({ hasText: "Paid" }).first()).toBeVisible();
  await pair(page, "commissions-list");

  const owed = page.getByRole("row", { name: /Okonkwo primary bath/ }).filter({ hasText: "Owed" }).first();
  await owed.getByRole("link").click();
  await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/commissions");
    return response.text();
  });
  expect(csv).toContain("Okonkwo primary bath");
  expect(csv).toContain("Paid");
  expect(csv).not.toContain("NaN");
  expect(csv).not.toContain("Infinity");
});
