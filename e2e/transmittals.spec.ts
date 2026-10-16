import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

test("transmittal link is acknowledged and a second package can be declined", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Transmittal due");
  await expect(page.locator("a:visible", { hasText: "Transmittal due" })).toContainText("1");

  await page.goto("/projects/proj_chen/transmittals");
  await page.getByLabel("Subject").fill("E2E valve set");
  await page.getByLabel("To").selectOption({ label: "Luis Ortega" });
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "E2E valve set" })).toBeVisible();
  await page.getByLabel("Note").fill("Valve heights");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.locator("[data-line='Valve heights']")).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.locator(".fl-pill[data-status=sent]")).toBeVisible();
  const officeUrl = page.url();
  const share = await page.locator("[data-share]").getAttribute("data-share");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/transmittals");
    return response.text();
  });
  expect(csv).toContain("E2E valve set");

  await page.context().clearCookies();
  await page.goto(share || "/");
  await page.waitForTimeout(3200);
  await page.getByLabel("Name").fill("E2E Ack");
  await page.getByLabel("Note").fill("Received the set");
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.locator("[data-ack='E2E Ack']")).toBeVisible();

  await signIn(page);
  await page.goto(officeUrl);
  await expect(page.locator("[data-ack='E2E Ack']")).toContainText("E2E Ack");
  await page.getByRole("link", { name: "Print" }).click();
  await expect(page.getByRole("heading", { name: "E2E valve set" })).toBeVisible();
  await expect(page.locator("[data-ack='E2E Ack']")).toBeVisible();

  await page.goto("/projects/proj_chen/transmittals");
  await page.getByLabel("Subject").fill("E2E decline set");
  await page.getByLabel("To").selectOption({ label: "Luis Ortega" });
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByLabel("Note").fill("Old drawing");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.locator(".fl-pill[data-status=sent]")).toBeVisible();
  const declineOffice = page.url();
  const declineShare = await page.locator("[data-share]").getAttribute("data-share");
  await page.context().clearCookies();
  await page.goto(declineShare || "/");
  await page.waitForTimeout(3200);
  await page.getByLabel("Reason").fill("Wrong revision");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.locator("[data-decline='Wrong revision']")).toBeVisible();
  await signIn(page);
  await page.goto(declineOffice);
  await expect(page.locator(".fl-pill[data-status=declined]")).toBeVisible();
  await expect(page.locator("[data-decline='Wrong revision']")).toBeVisible();
});
