import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

test("desktop shell, job split, and command menu", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await resetDemo(request);
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Office" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  const fontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(fontSize).toBe("13px");
  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("Command search")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Job" })).toBeVisible();
  await page.getByRole("link", { name: "Okonkwo primary bath", exact: true }).first().click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  await expect(page.getByLabel("Filter jobs")).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(scroll).toBe(true);
});

test("1024 hides the inspector and 768 does not scroll sideways", async ({ page, request }) => {
  await resetDemo(request);
  await signIn(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/projects/proj_okonkwo");
  await expect(page.getByLabel("Filter jobs")).toBeVisible();
  const inspector = page.locator(".mac-inspector");
  await expect(inspector).toBeHidden();
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(scroll).toBe(true);
});

test("phone width keeps the tab bar", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetDemo(request);
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Office" })).toBeHidden();
});
