import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("assign from unassigned, block the overlap, then move the card", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/dispatch");
  await expect(page.getByRole("heading", { name: "Dispatch" })).toBeVisible();
  const unassigned = page.getByRole("region", { name: "Unassigned" });
  const coil = unassigned.getByRole("article", { name: "Coil visit" });
  await expect(coil).toBeVisible();
  await expect(page.getByRole("region", { name: "Dana Cho" }).getByRole("article", { name: "Tile shower" })).toBeVisible();
  await coil.getByLabel("Start").fill("07:30");
  await coil.getByLabel("End").fill("08:30");
  await coil.getByLabel("Crew").selectOption({ label: "Dana Cho" });
  await coil.getByRole("button", { name: "Assign" }).click();
  await expect(coil.getByRole("alert")).toHaveText(/Overlaps Tile shower/);
  await expect(unassigned.getByRole("article", { name: "Coil visit" })).toBeVisible();
  await shot(page, "dispatch-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "dispatch-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await coil.getByLabel("Start").fill("08:30");
  await coil.getByLabel("End").fill("09:30");
  await coil.getByLabel("Crew").selectOption({ label: "Maya Rivera" });
  await coil.getByRole("button", { name: "Assign" }).click();
  const maya = page.getByRole("region", { name: "Maya Rivera" }).getByRole("article", { name: "Coil visit" });
  await expect(maya).toBeVisible();
  await maya.getByLabel("Start").fill("15:00");
  await maya.getByLabel("End").fill("16:00");
  await maya.getByLabel("Crew").selectOption({ label: "Luis Ortega" });
  await maya.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByRole("region", { name: "Luis Ortega" }).getByRole("article", { name: "Coil visit" })).toBeVisible();
  await page.goto("/");
  await revealToday(page, "Unassigned today");
  await expect(page.locator("a:visible", { hasText: "Unassigned today" })).toBeVisible();
});
