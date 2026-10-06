import { expect, test } from "@playwright/test";
import { contractDollars, kitchenThroughPaid, resetDemo, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test("lead, stub estimate, signature, and deposit payment", async ({ page }) => {
  await signIn(page);
  await kitchenThroughPaid(page);
});

test("client approves a change order and the contract and budget move", async ({ page }) => {
  await signIn(page);
  await page.goto("/projects/proj_okonkwo");
  const before = await contractDollars(page);
  const sink = page.locator('[data-code="PLB-SINK"]');
  const beforeBudget = (await sink.count()) > 0 ? await sink.locator('[data-kind="budget"]').innerText() : "";
  await page.getByLabel("Change order title").fill("Add a linen niche");
  await page.getByLabel("What changed").fill("Niche in the wet wall.");
  await page.getByLabel("Line name").fill("Linen niche");
  await page.getByLabel("Unit cost in dollars").fill("1000");
  await page.getByRole("button", { name: "Change order" }).click();
  await expect(page.getByText("Change order sent to the client portal.")).toBeVisible();
  await page.getByRole("link", { name: "Copy portal link" }).click();
  const order = page.getByRole("article").filter({ hasText: "Add a linen niche" });
  await order.getByPlaceholder("Type your name").fill("Amara Okonkwo");
  await order.getByRole("checkbox", { name: /By signing/ }).check();
  await order.getByRole("button", { name: "Approve change order" }).click();
  await expect(order.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.goto("/projects/proj_okonkwo");
  expect(await contractDollars(page)).toBeCloseTo(before + 1350, 2);
  await expect(page.getByText(/Add a linen niche · approved/)).toBeVisible();
  await expect(sink).toBeVisible();
  expect(await sink.locator('[data-kind="budget"]').innerText()).not.toBe(beforeBudget);
});

test("a follow-up draft is on Today and stays unsent until approved", async ({ page }) => {
  await signIn(page);
  const row = page.getByRole("listitem").filter({ hasText: "Briggs deck stain" });
  await expect(row).toBeVisible();
  await row.getByRole("link").click();
  const draft = page.getByRole("article").filter({ hasText: "Briggs deck stain — you opened the proposal" });
  await expect(draft.getByRole("button", { name: "Approve and send" })).toBeVisible();
  await expect(page.getByText("Sent to the local outbox")).toHaveCount(0);
  await draft.getByRole("button", { name: "Approve and send" }).click();
  await expect(page.getByText("Sent to the local outbox. Add a Resend key to deliver it.")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Briggs deck stain — you opened the proposal" })).toHaveCount(0);
});

test("a tester note is stored and listed for the owner", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByRole("textbox", { name: "Feedback", exact: true }).fill("The Today list made the unsigned Briggs draft obvious.");
  await page.getByRole("textbox", { name: "Feedback context" }).fill("Desktop, no screenshot");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/feedback");
  await expect(page.getByText("The Today list made the unsigned Briggs draft obvious.")).toBeVisible();
  await expect(page.getByText("Desktop, no screenshot")).toBeVisible();
  await expect(page.getByRole("link", { name: "/" })).toBeVisible();
});

test("office and portal crashes show a retry and a reference", async ({ page }) => {
  await signIn(page);
  await page.goto("/e2e/crash");
  await expect(page.getByRole("heading", { name: "The job file did not load." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/Reference [A-Za-z0-9_-]{4,32}/)).toBeVisible();
  await page.goto("/portal/e2e-crash");
  await expect(page.getByRole("heading", { name: "This project did not load." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/Reference [A-Za-z0-9_-]{4,32}/)).toBeVisible();
});
