import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: email.startsWith("dana") ? "My day" : "Today" })).toBeVisible();
}

async function draw(page: Page, label: string) {
  const canvas = page.getByLabel(label);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`missing ${label}`);
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 40);
  await page.mouse.up();
}

test("phone creates a ticket and the customer signs it", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ ...devices["Pixel 5"] });
  const page = await context.newPage();
  await resetDemo(page.request);
  await signInAs(page, "dana@rivera.demo");
  await page.getByRole("link", { name: "New ticket" }).click();
  await expect(page.getByRole("heading", { name: "New ticket" })).toBeVisible();
  await page.getByLabel("Job").selectOption("proj_okonkwo");
  await page.getByLabel("Location").fill("Shower");
  await page.getByLabel("Description").fill("Move the valve");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByRole("heading", { name: /TM-/ })).toBeVisible();
  await page.getByLabel("Hours").fill("2");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByLabel("Lines")).toContainText("Dana Cho");
  await expect(page.getByLabel("Lines")).toContainText("2 hr");
  await expect(page.getByText("$")).toHaveCount(0);
  await shot(page, "tm-phone-ticket-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "tm-phone-ticket-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Company name").fill("Dana Cho");
  await draw(page, "Company signature");
  await page.getByRole("button", { name: "Company signature" }).click();
  await expect(page.getByText("Ready for review")).toBeVisible();
  await page.getByLabel("Customer name").fill("Amara Okonkwo");
  await draw(page, "Customer signature");
  await shot(page, "tm-signature-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "tm-signature-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Customer signature" }).click();
  await expect(page.getByText("Field verified")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);
  await expect(page.getByText("$")).toHaveCount(0);
  await context.close();
});

test("the homeowner signs an unsigned ticket in the portal", async ({ page }) => {
  test.setTimeout(60_000);
  await resetDemo(page.request);
  await page.goto("/portal/demo_portal_brooks");
  const card = page.getByRole("article").filter({ hasText: "Extra compaction at the addition pad" });
  await expect(card).toContainText("Ready for review");
  await expect(card).toContainText("$");
  await card.getByLabel("Your name").fill("Chris Brooks");
  await draw(page, "Customer signature");
  await card.getByRole("button", { name: "Sign" }).click();
  await expect(card).toContainText("Field verified");
  await expect(card.getByRole("button", { name: "Sign" })).toHaveCount(0);
  await expect(card.getByAltText("Customer signature")).toBeVisible();
});

test("the office converts verified tickets to a change order and a cost-plus invoice", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signInAs(page, "maya@rivera.demo");
  await page.goto("/tm");
  await expect(page.getByRole("heading", { name: "T&M tickets" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByText("Draft", { exact: true })).toBeVisible();
  await expect(table.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(table.getByText("Field verified", { exact: true })).toBeVisible();
  await shot(page, "tm-office-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "tm-office-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByLabel("Select Ellis kitchen TM-003").check();
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.getByRole("dialog", { name: "Convert" })).toBeVisible();
  await shot(page, "tm-convert-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "tm-convert-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/tm/new?job=proj_okonkwo");
  await page.getByLabel("Description").fill("Valve move");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await page.getByLabel("Crew").selectOption("user_dana");
  await page.getByLabel("Hours").fill("1");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByLabel("Lines")).toContainText("$");
  await page.getByLabel("Customer name").fill("Amara Okonkwo");
  await draw(page, "Customer signature");
  await page.getByRole("button", { name: "Customer signature" }).click();
  await expect(page.getByText("Field verified")).toBeVisible();

  await page.goto("/tm");
  await page.getByLabel("Select Okonkwo primary bath TM-004").check();
  await page.getByRole("button", { name: "Convert" }).click();
  await page.getByRole("dialog", { name: "Convert" }).getByRole("button", { name: "Change order" }).click();
  await expect(page.getByRole("heading", { name: /CO / })).toBeVisible();
  await expect(page.getByText("Dana Cho")).toBeVisible();
  await page.goto("/tm?status=billed");
  await expect(page.getByRole("link", { name: "TM-004" })).toBeVisible();

  await page.goto("/tm?status=verified");
  await page.getByLabel("Select Ellis kitchen TM-003").check();
  await page.getByRole("button", { name: "Convert" }).click();
  await page.getByRole("dialog", { name: "Convert" }).getByRole("button", { name: "Cost-plus invoice" }).click();
  await expect(page.getByText("TM-003 · Cabinet filler")).toBeVisible();
  await page.goto("/tm/tm_el_verified");
  await expect(page.getByText("Billed")).toBeVisible();
  await expect(page.getByRole("link", { name: "RR-1070" })).toBeVisible();
});
