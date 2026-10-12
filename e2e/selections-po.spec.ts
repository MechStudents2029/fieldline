import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
}

test("creates a draft purchase order from a confirmed selection", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/projects/proj_brooks/selections");
  const hardware = page.getByRole("row", { name: /Door hardware/ });
  await expect(hardware).toContainText("Needs PO");
  await expect(page.getByRole("row", { name: /Door hardware/ })).toBeVisible();

  await page.getByRole("button", { name: "Order" }).click();
  const sheet = page.getByRole("dialog", { name: "Order" });
  await expect(sheet.getByRole("checkbox", { name: "Door hardware" })).toBeChecked();
  await sheet.getByRole("button", { name: "Create PO" }).click();
  await expect(hardware).toContainText("Ordered");
  await shot(page, "selections-po-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selections-po-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/purchase-orders");
  const draft = page.getByRole("row", { name: /Brooks/ }).filter({ hasText: "draft" });
  await expect(draft).toBeVisible();
  const link = draft.getByRole("link");
  await expect(link).toHaveText(/PO-\d+/);
  await link.click();
  await expect(page.getByText("Oil-rubbed bronze")).toBeVisible();
  await expect(page.getByText("Selection Door hardware")).toBeVisible();

  await page.goto("/projects/proj_brooks/selections");
  await page.getByRole("button", { name: "Order" }).click();
  await expect(page.getByRole("dialog", { name: "Order" })).toContainText("Nothing to order.");
});
