import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("draft a client update, publish it, and record the portal view", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);
  await expect(page.getByRole("link", { name: /Client updates/ })).toContainText("3");

  await page.goto("/estimates/est_vasquez");
  const addLine = page.getByRole("button", { name: "+ Add line" });
  const addAssembly = page.getByRole("button", { name: "Add assembly" });
  await expect(addLine).toBeVisible();
  await expect(addAssembly).toBeVisible();
  const lineBox = await addLine.boundingBox();
  const assemblyBox = await addAssembly.boundingBox();
  expect(lineBox && assemblyBox).toBeTruthy();
  expect(Math.abs(lineBox!.y - assemblyBox!.y)).toBeLessThan(4);

  await page.goto("/projects/proj_okonkwo/updates");
  await expect(page.getByRole("heading", { name: "Client updates" })).toBeVisible();
  await page.getByRole("link", { name: "New" }).click();
  await page.getByRole("button", { name: "Draft" }).click();
  const update = page.getByLabel("Update");
  await expect(update).toBeVisible();
  const text = await update.inputValue();
  expect(text).toContain("Set the shower wall");
  expect(text).not.toContain("inspector");
  await update.fill(`${text}\nThe niche is ready for grout.`);
  await shot(page, "client-update-editor-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "client-update-editor-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Published.");
  await page.goto("/portal/demo_portal_okonkwo/updates");
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
  await expect(page.getByText("The niche is ready for grout.")).toBeVisible();
  await expect(page.getByText("inspector")).toHaveCount(0);
  await shot(page, "portal-updates-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "portal-updates-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_okonkwo/updates");
  await expect(page.getByRole("table")).toContainText(/AM|PM/);
});
