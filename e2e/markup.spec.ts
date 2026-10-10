import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("photo markup, a plan pin, and the inspection edit sheet", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/projects/proj_okonkwo/markup/doc_o1");
  await expect(page.getByText("Marked up").first()).toBeVisible();
  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.getByRole("button", { name: "red" }).click();
  const photo = page.locator("[data-canvas=photo]");
  await expect(photo).toBeVisible();
  const box = await photo.boundingBox();
  if (!box) throw new Error("missing photo canvas");
  await page.mouse.move(box.x + 70, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 150);
  await page.mouse.up();
  await shot(page, "markup-photo-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "markup-photo-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Marked up").first()).toBeVisible();
  await page.getByRole("button", { name: "Original" }).click();
  await expect(page.getByRole("button", { name: "Marked up" })).toBeVisible();

  await page.goto("/projects/proj_okonkwo/plans/jf_ok_a101_r2");
  await expect(page.getByRole("link", { name: /Pin 1 Caulk the curb/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Pin 3 Valve height/ })).toBeVisible();
  await expect(page.getByText("Check before tile.")).toBeVisible();
  await shot(page, "plan-pins-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "plan-pins-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  const plan = page.locator("[data-canvas=plan]");
  const planBox = await plan.boundingBox();
  if (!planBox) throw new Error("missing plan canvas");
  await plan.click({ position: { x: Math.min(220, planBox.width / 2), y: Math.min(180, planBox.height / 3) } });
  const sheet = page.getByRole("dialog", { name: "Pin" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Link").selectOption({ label: "Seal the mirror edge" });
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: /Seal the mirror edge/ })).toBeVisible();

  await page.goto("/projects/proj_okonkwo/punch/punch_ok_curb");
  await expect(page.locator("[data-plan-crop]")).toBeVisible();
  await expect(page.getByText("Marked up").first()).toBeVisible();
  await shot(page, "punch-crop-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "punch-crop-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_brooks/permits?inspection=insp_br_rough");
  const detail = page.getByRole("complementary", { name: "Rough plumbing" });
  await expect(detail.getByText("Replace the vent stack")).toBeVisible();
  await expect(detail.getByRole("textbox", { name: "Notes" })).toHaveCount(0);
  await shot(page, "inspection-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "inspection-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await detail.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cancel" })).toBeVisible();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page.getByLabel("Name")).toHaveCount(0);

  await page.goto("/schedule?span=14");
  await expect(page.getByText("Held").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Columbus Day/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Person" })).toHaveCSS("position", "sticky");
  const drywall = page.getByRole("button", { name: /Drywall/ }).first();
  await drywall.scrollIntoViewIfNeeded();
  await shot(page, "schedule-held-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "schedule-held-dark");
  await page.emulateMedia({ colorScheme: "light" });
});
