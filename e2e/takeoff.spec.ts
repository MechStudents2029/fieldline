import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test("calibrate, measure, and update the draft estimate", async ({ page, request }) => {
  await resetDemo(request);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/proj_okonkwo/plans/jf_ok_a101_r2?takeoff=1&estimate=est_ok_takeoff");
  await expect(page.locator("[data-scale]")).toHaveText("10'");
  await expect(page.getByRole("button", { name: "Walls" })).toHaveAttribute("data-qty", "80000");
  const canvas = page.locator("[data-canvas=takeoff]");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Plan canvas has no box");
  await page.getByRole("button", { name: "Scale" }).click();
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.45 } });
  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.45 } });
  await page.getByLabel("Length").fill("12'");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.locator("[data-scale]")).toHaveText("12'");
  await page.getByLabel("Standard scale").selectOption({ label: `1/4" = 1'` });
  await expect(page.locator("[data-scale]")).toHaveText(`1/4" = 1'`);
  await expect(page.getByRole("button", { name: "Walls" })).toHaveAttribute("data-qty", "115200");
  await page.getByRole("button", { name: "Linear" }).click();
  const again = await canvas.boundingBox();
  if (!again) throw new Error("Plan canvas has no box");
  await canvas.click({ position: { x: again.width * 0.3, y: again.height * 0.7 } });
  await canvas.click({ position: { x: again.width * 0.6, y: again.height * 0.7 } });
  await page.getByLabel("Name").fill("Bench");
  await page.getByRole("button", { name: "Use" }).click();
  await expect(page.getByRole("button", { name: "Bench" })).toBeVisible();
  await page.getByRole("button", { name: "Walls" }).click();
  await shot(page, "takeoff-plan-light");
  await page.locator("[data-takeoff-pane]").screenshot({ path: "/opt/cursor/artifacts/takeoff-pane-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "takeoff-plan-dark");
  await page.locator("[data-takeoff-pane]").screenshot({ path: "/opt/cursor/artifacts/takeoff-pane-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/estimates/est_ok_takeoff");
  await expect(page.getByRole("link", { name: "Measure on plan" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Walls", exact: true })).toHaveValue("115.2");
  await expect(page.locator("[data-line='li_ok_tile'][data-col='qty']")).toHaveValue("130");
  await expect(page.getByText("Updated from plan").first()).toBeVisible();
  await shot(page, "estimate-from-takeoff-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "estimate-from-takeoff-dark");
});

test("a new plan revision keeps the measurements and flags them for review", async ({ page, request }) => {
  await resetDemo(request);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/proj_okonkwo/files");
  await page.getByRole("row", { name: /A-101 floor plan/ }).filter({ hasText: "Current" }).click();
  const pane = page.getByRole("complementary", { name: "File" });
  await pane.getByLabel("Revise A-101 floor plan").setInputFiles({
    name: "A-101.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  await pane.getByRole("button", { name: "Upload new revision" }).click();
  await pane.getByRole("button", { name: /Rev 3 · Current/ }).click();
  await expect(pane.getByRole("link", { name: "Plan" })).not.toHaveAttribute("href", "/projects/proj_okonkwo/plans/jf_ok_a101_r2");
  await pane.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "Takeoff" }).click();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Walls" }).first()).toBeVisible();
  await expect(page.locator("[data-scale]")).toHaveText("10'");
});
