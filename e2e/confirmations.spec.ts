import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

const portal = "/v/demo_vendor_harbor_m3p8qx7k";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: false });
}

test("office request, vendor confirm and decline, inbox, and a move that resets", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);

  await page.goto("/schedule/items/sch_ok_plumb");
  await expect(page.getByRole("heading", { name: "Set the valve" })).toBeVisible();
  await expect(page.locator("[data-confirm=requested]")).toHaveText("Requested");
  await page.getByRole("button", { name: "Request confirmation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Requested." })).toBeVisible();
  await expect(page.getByLabel("Portal link").last()).toHaveValue(new RegExp(portal));
  await expect(page.getByLabel("Message").last()).toHaveValue(/confirm Set the valve/);
  await shot(page, "confirmations-item-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "confirmations-item-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/schedule/items/sch_ok_trim");
  await page.getByRole("button", { name: "Request confirmation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Requested." })).toBeVisible();

  await page.goto(portal);
  const look = page.getByRole("region", { name: "Look-ahead" });
  await expect(look).toHaveAttribute("data-lookahead", "2");
  await expect(look.getByText("Set the valve")).toBeVisible();
  await expect(look.getByText("Trim out")).toBeVisible();
  await expect(look.getByText("Rough-in")).toBeVisible();
  await expect(look.getByText("Tile shower")).toHaveCount(0);
  await expect(look.getByText("Framing walk")).toHaveCount(0);
  await expect(look.getByText("Homeowner home after 3")).toHaveCount(0);
  await expect(look.getByText(/\$/)).toHaveCount(0);
  await look.getByRole("link", { name: "4", exact: true }).click();
  await expect(page.locator("[data-lookahead=4]")).toBeVisible();
  await expect(page.getByRole("region", { name: "Look-ahead" }).getByText("Tile shower")).toHaveCount(0);
  await shot(page, "vendor-lookahead-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "vendor-lookahead-dark");
  await page.emulateMedia({ colorScheme: "light" });

  const valve = page.locator("[data-item=sch_ok_plumb]");
  await valve.getByRole("button", { name: "Confirm" }).click();
  await expect(valve.getByText("Confirmed", { exact: true })).toBeVisible();
  const trim = page.locator("[data-item=sch_ok_trim]");
  await trim.getByLabel("Reason Trim out").fill("Need the valve spec");
  await trim.getByLabel("Proposed date Trim out").fill("2026-10-20");
  await trim.getByRole("button", { name: "Decline" }).click();
  await expect(trim.getByText("Declined", { exact: true })).toBeVisible();
  await expect(trim.getByText("Need the valve spec")).toBeVisible();

  await signIn(page);
  await page.goto("/schedule/items/sch_ok_plumb");
  await expect(page.locator("[data-confirm=confirmed]")).toHaveText("Confirmed");
  await expect(page.getByText("Harbor Plumbing").first()).toBeVisible();
  await page.goto("/inbox?filter=all");
  await expect(page.getByText("Confirmed Set the valve")).toBeVisible();
  await expect(page.getByText("Declined Trim out")).toBeVisible();

  await page.goto("/schedule/items/sch_ok_trim");
  await expect(page.locator("[data-confirm=declined]")).toHaveText("Declined");
  await expect(page.getByText("Need the valve spec")).toBeVisible();
  await page.getByRole("button", { name: "Propose date" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Requested." })).toBeVisible();

  await page.goto("/schedule/items/sch_ok_rough");
  await expect(page.locator("[data-confirm=confirmed]")).toHaveText("Confirmed");
  await page.getByLabel("End").fill("2026-11-20");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Resets Rough-in");
  await page.getByRole("button", { name: /Resets Rough-in/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.goto("/schedule/items/sch_ok_rough");
  await expect(page.locator("[data-confirm=requested]")).toHaveText("Requested");
  await expect(page.getByText("Reset", { exact: true })).toBeVisible();
});

test("confirmations list filters, the today row, and a job range request", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await revealToday(page, /unconfirmed starting in/);
  await expect(page.locator("a:visible", { hasText: /unconfirmed starting in 3 days/ })).toBeVisible();

  await page.goto("/confirmations");
  await expect(page.getByRole("heading", { name: "Confirmations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trim out" })).toBeVisible();
  await page.getByLabel("Status").selectOption("declined");
  await page.getByLabel("Vendor", { exact: true }).selectOption({ label: "Harbor Plumbing" });
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: "Trim out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rough-in" })).toHaveCount(0);
  await shot(page, "confirmations-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "confirmations-list-dark");
  await page.emulateMedia({ colorScheme: "light" });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("confirmations.csv");

  await page.goto("/projects/proj_okonkwo?view=gantt");
  await expect(page.locator("[data-gantt=job]")).toBeVisible();
  await expect(page.locator(".mac-inspector")).toBeHidden();
  await page.getByRole("button", { name: "Confirm" }).click();
  const range = page.getByRole("dialog", { name: "Confirm" });
  await range.getByLabel("Confirm from").fill("2026-10-11");
  await range.getByLabel("Confirm to").fill("2026-10-18");
  await range.getByRole("button", { name: "Request" }).click();
  await expect(range.getByRole("status")).toContainText("Requested.");
});
