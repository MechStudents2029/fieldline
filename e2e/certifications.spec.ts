import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

async function shot(page: Page, name: string, target?: Locator) {
  const buffer = target ? await target.screenshot() : await page.screenshot();
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const path = `/opt/cursor/artifacts/${name}.png`;
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.writeFileSync(path, buffer);
      return;
    } catch (error) {
      last = error;
      if (!String(error).includes("EIO")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw last;
}

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

async function csv(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/export/certifications");
    return { status: response.status, text: await response.text() };
  });
}

test("adds a card, shows expiry on Today, and hides numbers from field CSV", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetDemo(page.request);
  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible").filter({ hasText: "Certs" }).filter({ hasText: "2" })).toBeVisible();
  await page.goto("/certifications");
  await expect(page.locator("[data-cert='cred_dana_osha']")).toHaveAttribute("data-status", "expired");
  await expect(page.locator("[data-cert='cred_maya_osha']")).toHaveAttribute("data-window", "30");
  await expect(page.locator("[data-cert='cred_luis_fork']")).toHaveAttribute("data-window", "current");
  await expect(page.locator("[data-cert='cred_dana_osha']")).toContainText("Requested");
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "certifications-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "certifications-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  const form = page.getByRole("region", { name: "Credential" });
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Person").selectOption({ label: "Maya Rivera" });
  await form.getByLabel("Type").selectOption({ label: "CPR/First Aid" });
  await form.getByLabel("Number").fill("CPR-100");
  await form.getByLabel("Issued").fill("2026-01-02");
  await form.getByLabel("Expires").fill("2027-06-01");
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "certifications-capture-light", form);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "certifications-capture-dark", form);
  await page.emulateMedia({ colorScheme: "light" });
  await form.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/certifications\/cred_/);
  await expect(page.locator("[data-cert-detail]")).toHaveAttribute("data-status", "active");
  await expect(page.locator("[data-number]")).toHaveText("CPR-100");

  await page.goto("/certifications/cred_maya_osha");
  await page.getByRole("button", { name: "Mark requested" }).click();
  await expect(page.locator("[data-requested]")).toContainText("Maya Rivera");

  await signInAs(page, "riley@rivera.demo");
  await page.goto("/certifications/cred_maya_osha");
  await expect(page.locator("[data-number]")).toHaveText("2201");
  await expect(page.getByRole("button", { name: "Mark requested" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);

  await signInAs(page, "luis@rivera.demo");
  const office = await csv(page);
  expect(office.status).toBe(200);
  expect(office.text).not.toContain("OSHA-30-2201");
  expect(office.text).toContain("OSHA 30");

  await signInAs(page, "maya@rivera.demo");
  const owner = await csv(page);
  expect(owner.status).toBe(200);
  expect(owner.text).toContain("OSHA-30-2201");
  expect(owner.text).toContain("CPR-100");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/certifications");
  await expect(page.getByText("OSHA-30-2201")).toHaveCount(0);
  await expect(page.getByText("OSHA 30")).toHaveCount(0);
  await expect(page.getByText("OSHA-10-4419")).toBeVisible();
  await page.goto("/certifications/cred_maya_osha");
  await expect(page.locator("[data-cert-detail]")).toHaveCount(0);
  const own = await csv(page);
  expect(own.status).toBe(200);
  expect(own.text).not.toContain("OSHA-30-2201");
  expect(own.text).not.toContain("OSHA-10-4419");
  await page.goto("/settings/certifications");
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});
