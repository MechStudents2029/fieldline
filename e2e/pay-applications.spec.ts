import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

const portal = "/v/demo_vendor_harbor_m3p8qx7k";

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

test("submits a pay app from the vendor portal and approves it into one bill", async ({ page }) => {
  await resetDemo(page.request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Pay app age");
  await expect(page.locator("a:visible", { hasText: "Pay app age" })).toContainText("1");

  await page.goto("/projects/proj_brooks");
  await expect(page.locator("[data-pay-apps]")).toHaveAttribute("data-pay-apps", "3");

  await page.goto("/pay-applications/pa_br_1/print");
  await expect(page.getByRole("columnheader", { name: "Scheduled value" })).toBeVisible();
  await expect(page.getByText("AIA")).toHaveCount(0);

  await page.goto(portal);
  const apps = page.getByRole("region", { name: "Pay applications" });
  await expect(apps.getByText("SC-1049 1")).toBeVisible();
  await expect(apps.getByText("SC-1048")).toHaveCount(0);
  await apps.getByLabel("This period PLB-PA").fill("60.00");
  await apps.getByRole("button", { name: "Submit pay app" }).click();
  await expect(apps.getByText("Submitted")).toBeVisible();

  await page.goto("/pay-applications/pa_hb_1");
  await page.getByRole("button", { name: "Under review" }).click();
  await expect(page.locator(".fl-pill[data-status=under_review]")).toBeVisible();
  await page.getByLabel("Note PLB-PA").fill("Recheck stored");
  await page.getByRole("button", { name: "Revise & resubmit" }).click();
  await expect(page.locator(".fl-pill[data-status=revise]")).toBeVisible();

  await page.goto(portal);
  await expect(apps.getByText("Recheck stored")).toBeVisible();
  await apps.getByRole("button", { name: "Submit pay app" }).click();
  await expect(apps.getByText("Submitted")).toBeVisible();

  await page.goto("/pay-applications/pa_hb_1");
  await expect(page.locator("tr[data-line=PLB-PA]")).toContainText("$60");
  await page.getByRole("button", { name: "Under review" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".fl-pill[data-status=approved]")).toBeVisible();
  await expect(page.locator("[data-bill]")).toHaveCount(1);
  await expect(page.locator("[data-bill]")).toHaveText("SC-1049-PA1");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.goto("/pay-applications");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/pay-applications");
    return { status: response.status, text: await response.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.text).toContain("SC-1049");
  expect(csv.text).toContain("Harbor Plumbing");

  await page.goto("/portal/demo_portal_brooks");
  await expect(page.getByText("SC-1048")).toHaveCount(0);
  await expect(page.getByText("BE-PA1")).toHaveCount(0);
  await expect(page.getByText("SC-1049")).toHaveCount(0);

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/pay-applications");
  await expect(page.getByRole("heading", { name: "Not in this company" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Pay applications" })).toHaveCount(0);
  const denied = await page.evaluate(async () => (await fetch("/api/export/pay-applications")).status);
  expect(denied).toBe(404);
});
