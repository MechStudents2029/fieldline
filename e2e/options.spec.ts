import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

async function shot(page: Page, name: string) {
  const buffer = await page.screenshot();
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

test("build options, choose Better, and sign that contract", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/reports/builtin/option_tiers");
  await expect(page.getByRole("cell", { name: "Better", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "With options", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$13,500" }).first()).toBeVisible();

  await page.goto("/estimates/est_cho");
  const tabs = page.getByRole("navigation", { name: "Options" });
  await expect(tabs.getByRole("link", { name: "Good" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Better" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Best" })).toBeVisible();
  await expect(page.getByTestId("option-compare")).toBeVisible();
  await expect(page.getByTestId("client-total")).toHaveText("$13,500");
  await shot(page, "options-builder-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "options-builder-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await tabs.getByRole("link", { name: "Good" }).click();
  await expect(page.getByTestId("client-total")).toHaveText("$6,000");
  await expect(page.locator("[data-line='li_cho_good'][data-col='name']")).toBeVisible();
  await expect(page.locator("[data-line='li_cho_better']")).toHaveCount(0);
  await page.getByRole("button", { name: "Send proposal" }).click();

  const options = page.getByTestId("proposal-options");
  await expect(options).toBeVisible();
  await expect(options.locator("[data-option-name=Good]")).toContainText("$6,000.00");
  await expect(options.locator("[data-option-name=Better]")).toContainText("$13,500.00");
  await expect(options.locator("[data-option-name=Better]")).toContainText("Deposit");
  await expect(options.locator("[data-option-name=Best]")).toContainText("Tile shower and glass");
  await shot(page, "options-proposal-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "options-proposal-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await options.locator("[data-option-name=Better]").getByRole("button", { name: "Choose" }).click();
  await expect(options.locator("[data-option-name=Good]")).toContainText("Declined");
  await expect(options.locator("[data-option-name=Best]")).toContainText("Declined");
  await expect(options.locator("[data-option-name=Better]")).toHaveAttribute("data-state", "chosen");
  await page.getByLabel("Type your name to sign").fill("Helen Cho");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign proposal" }).click();
  await expect(page.getByLabel("Money")).toContainText("$13,500.00");
});
