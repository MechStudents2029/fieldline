import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

test("meeting minutes carry forward and the vendor sees their action", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Meeting due");
  await expect(page.locator("a:visible", { hasText: "Meeting due" })).toContainText("1");

  await page.goto("/projects/proj_chen/meetings");
  await page.getByLabel("Type").selectOption("oac");
  await page.getByLabel("Title").fill("E2E OAC");
  await page.getByLabel("Date").fill("2026-11-18");
  await page.getByLabel("Time").fill("09:00");
  await page.getByLabel("Location").fill("Site");
  await page.getByLabel("Vendor").selectOption({ label: "Harbor Plumbing" });
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "E2E OAC" })).toBeVisible();

  await page.getByLabel("Agenda item").fill("E2E niche");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("E2E niche")).toBeVisible();
  await page.getByLabel("Action E2E niche").fill("E2E valve check");
  await page.getByLabel("Assignee E2E niche").selectOption({ label: "Harbor Plumbing" });
  await page.getByLabel("Due E2E niche").fill("2026-12-02");
  await page.getByRole("button", { name: "Add action" }).click();
  await expect(page.locator("[data-action='E2E valve check']")).toBeVisible();

  await page.getByRole("button", { name: "Start minutes" }).click();
  await expect(page.locator("[data-status='minutes']")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("[data-status='approved']")).toBeVisible();
  await page.getByRole("button", { name: "Follow-up" }).click();
  await expect(page.getByText("from meeting #1")).toBeVisible();
  await expect(page.getByText("E2E niche")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/v/demo_vendor_harbor_m3p8qx7k");
  const meetings = page.getByRole("region", { name: "Meetings" });
  await expect(meetings).toContainText("E2E valve check");
  await expect(meetings).not.toContainText("Confirm niche depth");
});
