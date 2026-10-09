import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test("editing a measurement updates formula lines and leaves a typed line", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/estimates/est_vasquez");
  const walls = page.locator('input[aria-label="Walls"]');
  await expect(walls).toHaveValue("410");
  await expect(page.locator('[data-line="li_vz_drywall"][data-col="qty"]')).toHaveValue("480");
  await expect(page.locator('[data-line="li_vz_paint"][data-col="qty"]')).toHaveValue("451");
  await expect(page.locator('[data-line="li_vz_base"][data-col="qty"]')).toHaveValue("14");
  await expect(page.getByTestId("client-total")).toHaveText("$68,671");

  await walls.fill("500");
  await walls.press("Tab");
  await expect(page.locator('[data-line="li_vz_drywall"][data-col="qty"]')).toHaveValue("576");
  await expect(page.locator('[data-line="li_vz_paint"][data-col="qty"]')).toHaveValue("550");
  await expect(page.locator('[data-line="li_vz_base"][data-col="qty"]')).toHaveValue("14");
  await expect(page.getByTestId("client-total")).toHaveText("$69,262");

  await page.getByRole("button", { name: "Formula Drywall" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Formula Drywall" }).click();
  await expect(page.locator("[data-formula]")).toContainText("Walls x 1.10, round up to 32");
  await shot(page, "estimate-measure-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "estimate-measure-dark");
  await page.emulateMedia({ colorScheme: "light" });
});

test("purchase order comments are one field, and bill and change order match", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/purchase-orders/po_ok_retain");
  const comments = page.getByRole("region", { name: "Comments" });
  await comments.scrollIntoViewIfNeeded();
  await expect(comments.getByRole("heading", { name: "Comments" })).toHaveCount(1);
  await expect(page.getByText("No comments")).toHaveCount(0);
  await expect(page.getByText("Comment", { exact: true })).toHaveCount(0);
  await expect(comments.getByRole("textbox", { name: "Comment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lines" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bills" })).toBeVisible();
  await shot(page, "po-comments-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "po-comments-dark");
  await page.emulateMedia({ colorScheme: "light" });

  for (const route of ["/bills/bill_ok_ret_ready", "/projects/proj_okonkwo/orders/co_ok_1"]) {
    await page.goto(route);
    const thread = page.getByRole("region", { name: "Comments" });
    await expect(thread.getByRole("heading", { name: "Comments" })).toHaveCount(1);
    await expect(page.getByText("No comments")).toHaveCount(0);
    await expect(page.getByText("Comment", { exact: true })).toHaveCount(0);
    await expect(thread.getByRole("textbox", { name: "Comment" })).toBeVisible();
  }
});
