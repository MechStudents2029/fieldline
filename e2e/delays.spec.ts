import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

test("logs a delay, documents it, and converts once", async ({ page }) => {
  await resetDemo(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Delay age");
  await expect(page.locator("a:visible", { hasText: "Delay age" })).toContainText("1");
  await revealToday(page, "Weather delays");
  await expect(page.locator("a:visible", { hasText: "Weather delays" })).toContainText("1");

  await page.goto("/projects/proj_okonkwo/delays");
  await page.getByLabel("Title").fill("E2E rain delay");
  await page.getByLabel("Cause").selectOption("weather");
  await page.getByLabel("Impact").selectOption("partial");
  await page.getByLabel("Started").fill("2026-12-01T08:00");
  await page.getByLabel("Ended").fill("2026-12-01T12:00");
  await page.getByLabel("Weather").fill("52 F rain");
  await page.getByLabel("Cost code").fill("BATH-GLASS");
  await page.getByLabel("Hours").fill("2");
  await page.getByRole("button", { name: "Log" }).click();
  await expect(page.locator(".fl-pill[data-status=open]")).toBeVisible();

  await page.getByRole("button", { name: "Document" }).click();
  await expect(page.locator(".fl-pill[data-status=documented]")).toBeVisible();
  await page.getByLabel("Schedule item").selectOption({ label: "Tile shower" });
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.locator("[data-item='sch_ok_tile']")).toBeVisible();
  await page.getByRole("button", { name: "Mark shared" }).click();
  const share = await page.locator("[data-share]").getAttribute("href");
  expect(share).toContain("/d/");
  await page.goto(new URL(share || "/d/missing", "http://127.0.0.1").pathname);
  await expect(page.getByRole("heading", { name: "E2E rain delay" })).toBeVisible();
  await expect(page.getByText("52 F rain")).toBeVisible();

  await page.goBack();
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.locator(".fl-pill[data-status=converted]")).toBeVisible();
  await expect(page.locator("[data-event]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert" })).toHaveCount(0);

  await page.goto("/delays");
  await expect(page.getByRole("link", { name: "E2E rain delay" })).toBeVisible();
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/delays");
    return response.text();
  });
  expect(csv).toContain("E2E rain delay");
});
