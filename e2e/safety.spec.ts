import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

async function draw(page: Page, label: string) {
  const canvas = page.getByLabel(label);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`missing ${label}`);
  await page.mouse.move(box.x + 24, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 70);
  await page.mouse.up();
}

test("safety tab, missed talk, phone sign-off, and incident detail", async ({ page }) => {
  test.setTimeout(90_000);
  await resetDemo(page.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  await page.goto("/projects/proj_okonkwo/safety");
  const count = await page.locator("[data-safety-count]").getAttribute("data-safety-count");
  await expect(page.locator("[data-bar=toolbar] p")).toHaveText(count || "");
  expect(Number(count)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Heat illness" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ladder safety" })).toBeVisible();
  await expect(page.getByText("Splinter from the jamb")).toBeVisible();
  await shot(page, "safety-tab-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "safety-tab-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/safety?type=talk&status=missed");
  await expect(page.getByRole("link", { name: "Fall protection" })).toBeVisible();
  await expect(page.locator("[data-status=missed]")).toContainText("Missed");

  await page.goto("/safety/incidents/inc_br_stair");
  await expect(page.getByRole("paragraph").filter({ hasText: "Stair opening near miss" })).toBeVisible();
  await expect(page.getByLabel("Factors")).toHaveValue("Cover shifted during demo.");
  await expect(page.getByRole("link", { name: "Re-cover the stair opening" })).toBeVisible();
  await shot(page, "incident-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "incident-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await page.goto("/projects/proj_okonkwo/safety/talks/talk_ok_today");
  await expect(page.getByText("Water, shade, and rest.")).toBeVisible();
  await expect(page.getByText("Agua, sombra y descanso.")).toBeVisible();
  await expect(page.getByLabel("Sign Dana Cho")).toBeVisible();
  await shot(page, "toolbox-signoff-phone-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "toolbox-signoff-phone-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await draw(page, "Sign Dana Cho");
  await page.getByRole("textbox", { name: "Visitor", exact: true }).fill("Inspector Ruiz");
  await draw(page, "Sign visitor");
  await page.getByRole("button", { name: "Complete" }).click();
  await expect(page.locator("[data-status=completed]")).toContainText("Completed");
  await expect(page.getByText("Inspector Ruiz")).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete" })).toHaveCount(0);

  await page.goto("/safety");
  await expect(page.getByRole("link", { name: "Splinter from the jamb" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Stair opening near miss" })).toHaveCount(0);

  await page.goto("/portal/demo_portal_brooks");
  await expect(page.getByText("Stair opening near miss")).toHaveCount(0);
  await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
  await expect(page.getByText("Stair opening near miss")).toHaveCount(0);
});
