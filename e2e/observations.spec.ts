import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

const portal = "/v/demo_vendor_harbor_m3p8qx7k";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("office assigns an observation, the vendor marks it ready, and the office closes it", async ({ page }) => {
  await resetDemo(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Obs due");
  await expect(page.locator("a:visible", { hasText: "Obs due" })).toContainText("1");
  await revealToday(page, "Obs review");
  await expect(page.locator("a:visible", { hasText: "Obs review" })).toContainText("1");

  await page.goto("/observations");
  await page.getByLabel("New job").selectOption({ label: "Okonkwo primary bath" });
  await page.getByLabel("Title").fill("E2E valve gap");
  await page.getByLabel("New type").selectOption({ label: "Quality" });
  await page.getByLabel("New priority").selectOption({ label: "High" });
  await page.getByLabel("Vendor", { exact: true }).selectOption({ label: "Harbor Plumbing" });
  await page.getByLabel("Due").fill("2026-11-20");
  await page.getByLabel("Description").fill("Gap at the wall.");
  await page.getByRole("button", { name: "Add observation" }).click();
  await page.waitForURL(/\/observations\/obs_/);
  const url = page.url();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".fl-pill[data-status=open]")).toBeVisible();

  await page.goto(portal);
  const card = page.getByRole("region", { name: "Observations" }).locator("[data-observation='E2E valve gap']");
  await card.getByLabel("Note E2E valve gap").fill("Set the valve back");
  await card.getByLabel("Photo E2E valve gap").setInputFiles({ name: "gap.png", mimeType: "image/png", buffer: png });
  await card.getByRole("button", { name: "Ready for review" }).click();
  await expect(card).toHaveCount(0);

  await page.goto(url);
  await expect(page.locator(".fl-pill[data-status=ready]")).toBeVisible();
  await page.getByLabel("Return note").fill("Redo the gap");
  await page.getByRole("button", { name: "Not accepted" }).click();
  await expect(page.locator(".fl-pill[data-status=open]")).toBeVisible();

  await page.goto(portal);
  await expect(card.getByText("Redo the gap")).toBeVisible();
  await card.getByLabel("Note E2E valve gap").fill("Set again");
  await card.getByRole("button", { name: "Ready for review" }).click();
  await expect(card).toHaveCount(0);

  await page.goto(url);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".fl-pill[data-status=closed]")).toBeVisible();

  await page.goto(`${url}/print`);
  await expect(page.getByRole("heading", { name: "E2E valve gap" })).toBeVisible();

  const csv = await page.evaluate(async () => {
    const res = await fetch("/api/export/observations");
    return { status: res.status, text: await res.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.text).toContain("E2E valve gap");
  expect(csv.text).toContain("Open stair guard");

  await page.goto("/portal/demo_portal_okonkwo");
  await expect(page.getByText("E2E valve gap")).toHaveCount(0);
  await expect(page.getByText("Open stair guard")).toHaveCount(0);
  await expect(page.getByText("Shower valve rough is proud")).toHaveCount(0);
});
