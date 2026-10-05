import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test("a new company starts empty and the checklist advances after a lead and estimate", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Start a new company" }).click();
  await expect(page.getByRole("heading", { name: "Start a new company" })).toBeVisible();
  await page.getByLabel("Owner name").fill("Avery Cole");
  await page.getByLabel("Work email").fill(`avery-${Date.now()}@cole.example`);
  await page.getByLabel("New password").fill("fieldline-test");
  await page.getByLabel("Company name").fill("Cole Kitchens");
  await page.getByLabel("Trade").selectOption("remodel");
  await page.getByLabel("State").selectOption("CA");
  await page.getByRole("checkbox", { name: /starter price book/i }).check();
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing on the board yet" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Review the price book" }).getByText("Done")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Company license" }).getByRole("link", { name: "Add your license" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Add your first lead" }).getByRole("link", { name: "Add a lead" })).toBeVisible();

  await page.goto("/leads/new");
  await page.getByLabel("Scope").fill(
    "Avery Cole, avery.client@cole.example, 180 sq ft kitchen gut, new cabinets, quartz, 12 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights.",
  );
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name: /Avery Cole/ })).toBeVisible();
  await page.getByRole("button", { name: "Draft estimate from price book" }).click();
  await expect(page.getByText("Sell price")).toBeVisible();
  await expect(page.getByText("CAB-BASE")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("listitem").filter({ hasText: "Add your first lead" }).getByText("Done")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Draft your first estimate" }).getByText("Done")).toBeVisible();
  const proposal = page.getByRole("listitem").filter({ hasText: "Send a test proposal to yourself" });
  await expect(proposal.getByRole("link", { name: "Open the estimate" })).toBeVisible();
  await expect(proposal.getByText("Done")).toHaveCount(0);
});
