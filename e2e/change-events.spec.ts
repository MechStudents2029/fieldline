import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

test("logs a change event, prices it, and converts once", async ({ page }) => {
  await resetDemo(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Event age");
  await expect(page.locator("a:visible", { hasText: "Event age" })).toContainText("1");
  await revealToday(page, "Price due");
  await expect(page.locator("a:visible", { hasText: "Price due" })).toContainText("1");

  await page.goto("/projects/proj_okonkwo/changes");
  await page.getByLabel("Title").fill("E2E niche extra");
  await page.getByLabel("Reason").selectOption("owner");
  await page.getByLabel("Cost code").fill("BATH-GLASS");
  await page.getByLabel("ROM cost").fill("100");
  await page.getByLabel("ROM price").fill("140");
  await page.getByRole("button", { name: "Log" }).click();
  await expect(page.locator(".fl-pill[data-status=open]")).toBeVisible();

  await page.getByLabel("Vendor").selectOption({ label: "Harbor Plumbing" });
  await page.getByLabel("Quote due").fill("2026-12-01");
  await page.getByRole("button", { name: "Ask" }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await page.getByRole("button", { name: "Mark requested" }).click();
  await expect(page.locator(".fl-pill[data-status=pricing]")).toBeVisible();

  await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
  const card = page.locator("[data-quote='E2E niche extra']");
  await card.getByLabel("Amount E2E niche extra").fill("125.00");
  await card.getByLabel("Days E2E niche extra").fill("3");
  await card.getByLabel("Note E2E niche extra").fill("E2E extra");
  await card.getByRole("button", { name: "Send price" }).click();
  await expect(card.getByText("E2E extra")).toBeVisible();

  await page.goto("/change-events");
  await page.getByRole("link", { name: "E2E niche extra" }).click();
  await page.getByRole("button", { name: "Use" }).click();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.locator(".fl-pill[data-status=ready]")).toBeVisible();
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.locator(".fl-pill[data-status=converted]")).toBeVisible();
  await expect(page.locator("[data-co]")).toBeVisible();
  await expect(page.locator("[data-po]")).toHaveAttribute("data-po", /^PO-\d+$/);
  await expect(page.getByRole("button", { name: "Convert" })).toHaveCount(0);

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/change-events");
    return response.text();
  });
  expect(csv).toContain("E2E niche extra");

  await page.context().clearCookies();
  await page.goto("/portal/demo_portal_okonkwo");
  await expect(page.getByText("E2E niche extra")).toHaveCount(0);
  await page.goto("/v/demo_vendor_brighton_k4n2p9qx");
  await expect(page.getByText("E2E niche extra")).toHaveCount(0);
});
