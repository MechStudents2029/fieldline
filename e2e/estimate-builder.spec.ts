import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test("keyboard edits, line changes, and target margin update the client preview", async ({ page }) => {
  await signIn(page);
  await page.goto("/estimates/est_vasquez");
  await expect(page.getByRole("grid", { name: "Estimate lines" })).toBeVisible();
  await expect(page.getByText("CAB-BASE")).toBeVisible();
  await expect(page.getByTestId("client-total")).toHaveText("$68,671");
  await expect(page.getByTestId("client-preview")).not.toContainText("$900");

  const qty = page.locator('[data-line="li_vz_base"][data-col="qty"]');
  await qty.click();
  await qty.fill("15");
  await qty.press("Tab");
  await expect(page.locator('[data-line="li_vz_base"][data-col="unit"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-line="li_vz_base"][data-col="cost"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-line="li_vz_base"][data-col="markup"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-line="li_vz_wall"][data-col="markup"]')).toBeFocused();
  await expect(page.getByTestId("client-total")).not.toHaveText("$68,671");
  await expect(page.locator('[data-preview-line="li_vz_base"]')).toContainText("15");
  await expect(page.getByText("Line saved.")).toBeVisible();

  await page.locator('[data-line="li_vz_base"][data-col="name"]').press("Control+Enter");
  const blank = page.locator("input[data-col='name']:focus");
  await expect(blank).toHaveValue("");
  await blank.press("Backspace");
  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  const restored = page.locator("input[data-col='name']:focus");
  await expect(restored).toHaveValue("");
  await restored.press("Backspace");
  await expect(page.locator("input[data-col='name']:focus")).toHaveCount(0);

  await expect(page.getByTestId("gross-margin")).toHaveText("30%");
  await page.getByLabel("Target margin").fill("35");
  await expect(page.getByTestId("reprice-preview")).toContainText("35%");
  await expect(page.getByTestId("gross-margin")).toHaveText("30%");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Line saved.")).toBeHidden();
  await expect(page.getByText("Line saved.")).toBeVisible();
  await expect(page.getByTestId("gross-margin")).toHaveText("35%");
  await expect(page.getByTestId("client-total")).not.toHaveText("$68,671");
  await expect(page.getByTestId("client-preview")).toContainText("Allowance · Appliance allowance");
  await expect(page.getByTestId("client-preview")).toContainText("Optional · Upgraded edge profile");

  await page.reload();
  await expect(page.locator('[data-line="li_vz_base"][data-col="qty"]')).toHaveValue("15");
  await expect(page.getByTestId("gross-margin")).toHaveText("35%");
});
