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
  await expect(sheet.getByRole("status")).toContainText(/PO-\d+/);
  await expect(hardware).toContainText("Ordered");
  await shot(page, "selections-po-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selections-po-dark");
  await page.emulateMedia({ colorScheme: "light" });

  const number = (await sheet.getByRole("status").innerText()).trim();
  await page.goto("/purchase-orders");
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  await page.getByRole("link", { name: number }).click();
  await expect(page.getByText("Oil-rubbed bronze")).toBeVisible();
  await expect(page.getByText("Selection Door hardware")).toBeVisible();

  await page.goto("/projects/proj_brooks/selections");
  await page.getByRole("button", { name: "Order" }).click();
  await expect(page.getByRole("dialog", { name: "Order" })).toContainText("Nothing to order.");
});
