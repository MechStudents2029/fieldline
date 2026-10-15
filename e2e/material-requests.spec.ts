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

test("submits a material request, approves it, and issues it from the yard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetDemo(page.request);
  await signInAs(page, "dana@rivera.demo");
  const form = page.getByRole("region", { name: "Material request" });
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Job").selectOption({ label: "Brooks family room addition" });
  await form.getByLabel("SKU", { exact: true }).selectOption("stk_tile");
  await form.getByLabel("Qty", { exact: true }).fill("1");
  await page.emulateMedia({ colorScheme: "light" });
  await form.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, "material-requests-capture-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "material-requests-capture-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await form.getByRole("button", { name: "Submit" }).click();
  await page.waitForURL(/\/material-requests\/mrq_/);
  const requestUrl = page.url();
  await expect(page.locator("[data-request-detail]")).toHaveAttribute("data-status", "submitted");
  await expect(page.locator("[data-duplicate]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await signInAs(page, "riley@rivera.demo");
  await page.goto(requestUrl);
  await expect(page.locator("[data-request-detail]")).toHaveAttribute("data-status", "submitted");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/");
  const more = page.locator("details[data-today-more]:visible summary");
  await more.click();
  await expect(page.locator("a:visible").filter({ hasText: "Materials" }).first()).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("Need tile").first()).toBeVisible();
  await page.goto("/material-requests");
  await expect(page.locator("[data-request='mrq_urgent']")).toHaveAttribute("data-urgency", "urgent");
  await expect(page.locator("[data-request='mrq_po']")).toHaveAttribute("data-status", "ordered");
  await expect(page.getByText("Quartz vanity")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "material-requests-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "material-requests-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto(requestUrl);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("[data-request-detail]")).toHaveAttribute("data-status", "approved");
  await page.getByLabel("Place").selectOption({ label: "Yard" });
  await page.getByRole("button", { name: "Fulfill" }).click();
  await expect(page.locator("[data-request-detail]")).toHaveAttribute("data-status", "fulfilled");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/material-requests");
    return { ok: response.ok, status: response.status, text: await response.text() };
  });
  expect(csv.status, csv.text.slice(0, 200)).toBe(200);
  expect(csv.text).toContain("Floor tile, set");
  expect(csv.text).toContain("Quartz vanity");
  expect(csv.text).toContain("PO-1056");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/material-requests");
  await expect(page.getByText("Quartz vanity")).toHaveCount(0);
  await expect(page.getByText("Extra blades")).toBeVisible();
  await page.goto("/material-requests/mrq_no");
  await expect(page.locator("[data-reject-note]")).toHaveText("Already on the truck.");
  const own = await page.evaluate(async () => {
    const response = await fetch("/api/export/material-requests");
    return { ok: response.ok, status: response.status, text: await response.text() };
  });
  expect(own.status, own.text.slice(0, 200)).toBe(200);
  expect(own.text).toContain("Floor tile, set");
  expect(own.text).not.toContain("Quartz vanity");
  expect(own.text).not.toContain("PO-1056");
});
