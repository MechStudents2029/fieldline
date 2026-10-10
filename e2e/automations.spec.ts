import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("create a rule, watch it fire, and read the run log", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/settings/automations");
  await expect(page.getByRole("link", { name: "Sold kitchen job" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Failed inspection" })).toBeVisible();
  await expect(page.getByRole("link", { name: "COI expiring in 14 days" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Incident schedules a talk" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "On" }).first()).toBeVisible();
  await shot(page, "automations-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "automations-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("link", { name: "Sold kitchen job" }).click();
  await expect(page.getByText("When")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add condition" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add action" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Sold kitchen job");
  await shot(page, "automations-sheet-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "automations-sheet-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/settings/automations?log=rule_sold_kitchen");
  await expect(page.getByRole("cell", { name: "Okonkwo primary bath" })).toBeVisible();
  await expect(page.getByText("skipped")).toBeVisible();
  await shot(page, "automations-log-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "automations-log-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/settings/automations?rule=new");
  await page.getByLabel("Name").fill("E2E inspection");
  await page.getByLabel("Trigger").selectOption("inspection_result");
  await page.getByLabel("Result").selectOption("failed");
  await page.getByRole("button", { name: "+ Add action" }).click();
  await page.getByRole("combobox", { name: "Action 1", exact: true }).selectOption("punch");
  await page.getByLabel("Title").fill("E2E punch from inspection");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/rule=/);

  await page.goto("/projects/proj_brooks/permits?inspection=insp_br_rough&edit=1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/settings/automations?log=");
  await page.goto("/settings/automations");
  await page.getByRole("row", { name: /E2E inspection/ }).getByRole("link", { name: "Log" }).click();
  await expect(page.getByRole("cell", { name: "Rough plumbing" })).toBeVisible();
  await expect(page.getByText("E2E punch from inspection")).toBeVisible();
  await expect(page.getByText("ok", { exact: true })).toBeVisible();
});
