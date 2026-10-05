import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test("an owner invites a field teammate who sees the job without prices", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/settings");
  const email = `casey-${Date.now()}@field.example`;
  await page.getByLabel("Teammate email").fill(email);
  await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("field");
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Nothing was emailed. Copy the link into a text. It is shown once.")).toBeVisible();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toContain("/invite/");

  const context = await browser.newContext();
  const invitee = await context.newPage();
  const response = await invitee.goto(link);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(invitee.getByRole("heading", { name: /Join Rivera Remodeling/ })).toBeVisible();
  await expect(invitee.getByText(/as Field/)).toBeVisible();
  await invitee.getByLabel("Your name").fill("Casey Cho");
  await invitee.getByLabel("New password").fill("fieldline-test");
  await invitee.getByRole("button", { name: "Create account and join" }).click();
  await expect(invitee.getByRole("heading", { name: "Today" })).toBeVisible();
  await invitee.goto("/projects");
  await invitee.getByRole("link", { name: /Okonkwo primary bath/ }).click();
  await expect(invitee.getByRole("heading", { name: "Okonkwo primary bath" })).toBeVisible();
  await expect(invitee.getByText("Prices, costs, and margin are hidden for the field role.")).toBeVisible();
  await expect(invitee.getByText("Live margin")).toHaveCount(0);
  await invitee.goto("/invoices");
  await expect(invitee.getByText("Invoices are hidden for the field role.")).toBeVisible();
  await expect(invitee.getByText("RR-1033")).toHaveCount(0);
  await invitee.goto("/price-book");
  await expect(invitee.getByText("Pricing is hidden for the field role.")).toBeVisible();
  await context.close();
});
