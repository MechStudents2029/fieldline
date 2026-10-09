import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test("an assembly follows its measurement, and the editor keeps the totals clear", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);

  await page.goto("/price-book/assemblies/new");
  await page.getByLabel("Assembly name").fill("Bench run");
  await page.getByLabel("Driving measurement").selectOption("length");
  await page.getByLabel("Part name").fill("Bench boards");
  await page.getByLabel("Formula").fill("Qty");
  await page.getByLabel("Waste").fill("10");
  await page.getByLabel("Unit").selectOption("lf");
  await page.getByLabel("Unit cost").fill("25");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/price-book\/assemblies\/asm_/);
  await expect(page.getByLabel("Assembly name")).toHaveValue("Bench run");
  await shot(page, "assembly-editor-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "assembly-editor-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/estimates/est_vasquez");
  const before = await page.getByTestId("client-total").innerText();
  await page.getByRole("button", { name: "Add assembly" }).click();
  await page.getByLabel("Assembly").selectOption({ label: "Bench run" });
  await page.getByLabel("Assembly measurement").selectOption({ label: "New" });
  await page.getByLabel("New measurement").fill("Bench");
  await page.getByLabel("New measurement value").fill("20");
  await page.getByRole("button", { name: "Insert" }).click();

  const group = page.locator('[data-assembly="Bench run"]');
  await group.scrollIntoViewIfNeeded();
  await expect(group).toBeVisible();
  const benchLine = page.locator(".est-line", { has: page.locator('input[value="Bench boards"]') });
  await expect(benchLine.locator('[data-col="qty"]')).toHaveValue("22");
  await expect(page.getByTestId("client-total")).not.toHaveText(before);
  const mid = await page.getByTestId("client-total").innerText();

  const bench = page.locator('input[aria-label="Bench"]');
  await bench.fill("40");
  await bench.press("Tab");
  await expect(benchLine.locator('[data-col="qty"]')).toHaveValue("44");
  await expect(page.getByTestId("client-total")).not.toHaveText(mid);

  const grid = page.getByRole("grid", { name: "Estimate lines" });
  const comments = page.getByRole("region", { name: "Comments" });
  const gridBox = await grid.boundingBox();
  const commentsBox = await comments.boundingBox();
  expect(commentsBox!.x).toBeGreaterThan((gridBox?.x ?? 0) + 400);
  const add = page.getByRole("button", { name: "+ Add line" });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeVisible();
  const addBox = await add.boundingBox();
  const totalsBox = await page.locator(".estimate-totals").boundingBox();
  expect(addBox!.y + addBox!.height).toBeLessThanOrEqual((totalsBox?.y ?? 0) + 2);
  await expect(page.locator(".est-confidence")).toHaveCount(0);
  await expect(page.locator("[data-measure]").getByRole("button", { name: /^Delete / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions Floor" })).toBeVisible();

  await group.scrollIntoViewIfNeeded();
  await shot(page, "estimate-assembly-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "estimate-assembly-dark");
  await page.emulateMedia({ colorScheme: "light" });
});
