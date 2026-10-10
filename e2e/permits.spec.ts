import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("permits, a failed inspection, the gate, and the variance report", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/projects/proj_brooks/permits");
  await expect(page.getByRole("heading", { name: "Permits" })).toBeVisible();
  await expect(page.getByText("B-2026-014")).toBeVisible();
  await expect(page.getByText("Issued").first()).toBeVisible();
  await shot(page, "permits-job-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "permits-job-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_brooks/permits?inspection=insp_br_rough");
  await expect(page.getByText("Replace the vent stack")).toBeVisible();
  await expect(page.getByText("Strap the supply")).toBeVisible();
  await expect(page.getByRole("button", { name: "To-dos" })).toBeVisible();
  await shot(page, "inspection-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "inspection-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/schedule?span=14");
  const drywall = page.getByRole("button", { name: /Drywall/ });
  await drywall.scrollIntoViewIfNeeded();
  await expect(drywall).toBeVisible();
  await expect(page.locator(".baseline-tick").first()).toBeVisible();
  await expect(page.locator(".is-gate").first()).toBeVisible();
  await shot(page, "schedule-gate-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "schedule-gate-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Inspections/ })).toContainText("1");
  await expect(page.getByRole("link", { name: /^Failed inspections/ })).toContainText("1");
  await expect(page.getByRole("link", { name: /^Permits expiring/ })).toContainText("1");
  await shot(page, "today-inspections-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "today-inspections-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/reports/schedule");
  await expect(page.getByRole("heading", { name: "Schedule variance" })).toBeVisible();
  const job = page.getByRole("cell", { name: "Brooks family room addition" });
  await expect(job).toBeVisible();
  await expect(job).toHaveCSS("white-space", "normal");
  await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Weather" })).toBeVisible();
  await page.getByRole("link", { name: "All jobs" }).click();
  await expect(page.getByRole("row", { name: /Chen powder room/ })).toBeVisible();
  await page.getByRole("link", { name: "Baseline" }).click();
  await expect(page.getByRole("row", { name: /Chen powder room/ })).toHaveCount(0);
  await shot(page, "schedule-variance-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "schedule-variance-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/projects/proj_chen/permits?new=permit");
  await page.getByLabel("Type").selectOption("building");
  await page.getByLabel("Number").fill("C-100");
  await page.getByLabel("Jurisdiction").fill("Austin");
  await page.getByLabel("Status").selectOption("issued");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("C-100")).toBeVisible();
  await page.getByRole("link", { name: "Add inspection" }).click();
  await page.getByLabel("Name").fill("Rough plumbing");
  await page.getByLabel("Result").selectOption("failed");
  await page.getByLabel("Notes").fill("Replace the trap\nStrap the line");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("link", { name: "Rough plumbing" }).click();
  await page.getByRole("button", { name: "To-dos" }).click();
  await expect(page.getByText("Replace the trap")).toBeVisible();
  await expect(page.getByText("Strap the line")).toBeVisible();

  await page.goto("/schedule?span=14");
  await page.getByRole("button", { name: /Drywall/ }).click();
  await page.getByLabel("Status").selectOption("done");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("has not passed");
  await expect(page.getByRole("button", { name: "Move anyway" })).toBeVisible();
});
