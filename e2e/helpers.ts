import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function resetDemo(request: APIRequestContext) {
  const response = await request.post("/api/e2e/reset");
  expect(response.ok()).toBeTruthy();
}

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("maya@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

export async function contractDollars(page: Page) {
  const text = await page.getByText(/Contract \$/).innerText();
  const match = text.match(/\$[\d,]+\.\d{2}/);
  if (!match) throw new Error(`No contract amount in: ${text}`);
  return Number(match[0].replace(/[$,]/g, ""));
}

/** Lead from pasted text through a paid deposit, on whatever viewport the test set. */
export async function kitchenThroughPaid(page: Page) {
  await page.goto("/leads/new");
  await page.getByLabel("Scope").fill(
    "Nora Cho, nora.cho.e2e@example.com, 240 sq ft kitchen, gut, new cabinets, quartz, 14 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights. Budget $60–80k. 410 Grove Ave, Oakland.",
  );
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name: /Nora Cho/ })).toBeVisible();
  await page.getByRole("button", { name: "Draft estimate from price book" }).click();
  await expect(page.getByText("Price", { exact: true })).toBeVisible();
  await page.locator("article input[name='name']").first().fill("E2E quartz edge");
  await page.getByRole("button", { name: "Save line" }).first().click();
  await expect(page.getByText("Line saved.")).toBeVisible();
  await expect(page.locator("article input[name='name']").first()).toHaveValue("E2E quartz edge");
  await page.getByRole("checkbox", { name: /Send even if margin/ }).check();
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole("heading", { name: "Sign" })).toBeVisible();
  await page.getByLabel("Type your name to sign").fill("Nora Cho");
  await page.getByRole("checkbox", { name: /By signing/ }).check();
  await page.getByRole("button", { name: "Sign proposal" }).click();
  await expect(page).toHaveURL(/\/portal\//);
  await expect(page.getByRole("heading", { name: "Kitchen remodel" })).toBeVisible();
  await expect(page.getByText("Hello Nora.")).toBeVisible();
  await page.getByRole("link", { name: /^Pay / }).click();
  await expect(page.getByRole("button", { name: "Pay by ACH" })).toBeVisible();
  await page.getByRole("button", { name: "Pay by ACH" }).click();
  await expect(page.getByRole("heading", { name: "Paid" })).toBeVisible();
  await page.goto("/projects");
  await page.getByRole("link", { name: /410 Grove Ave/ }).click();
  await expect(page.getByText(/Contract \$/)).toBeVisible();
  await expect(page.locator('[data-kind="budget"]').first()).toBeVisible();
  await expect(page.getByRole("link", { name: /deposit · paid/ })).toBeVisible();
}
