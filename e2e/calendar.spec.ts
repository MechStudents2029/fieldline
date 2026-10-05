import { expect, test, type Page } from "@playwright/test";
import { addCalendarDays, localDay, localWeek } from "../src/lib/time/calendar";
import { resetDemo } from "./helpers";

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: /Today|My day/ })).toBeVisible();
}

test("changing the week start regroups unlocked hours and leaves approved labor", async ({ page, request }) => {
  await resetDemo(request);
  const zone = "America/New_York";
  const today = localDay(Date.now(), zone);
  const mondayWeek = localWeek(Date.now(), { timeZone: zone, weekStartsOn: 1 });
  const sundayWeek = localWeek(Date.now(), { timeZone: zone, weekStartsOn: 0 });
  const past = Array.from({ length: 8 }, (_, index) => addCalendarDays(today, -index));
  const inWeek = (day: string, startDay: string) => day >= startDay && day < addCalendarDays(startDay, 7);
  const day = past.find((candidate) => inWeek(candidate, sundayWeek.startDay) !== inWeek(candidate, mondayWeek.startDay));
  expect(day).toBeTruthy();

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/time");
  await expect(page.getByText("The week starts Monday")).toBeVisible();
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Add time for someone" }) });
  await panel.getByLabel("Teammate").selectOption({ label: "Maya Rivera" });
  await panel.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
  await panel.getByLabel("Cost code").selectOption("GC-SUPER");
  await panel.getByLabel("Clock in").fill(`${day}T09:00`);
  await panel.getByLabel("Clock out").fill(`${day}T13:00`);
  await panel.getByLabel("Reason").fill("Week boundary check");
  await panel.getByRole("button", { name: "Add manual entry" }).click();
  await expect(page.getByText("4h 00m · pending")).toBeVisible();
  const weekHours = page.getByLabel("Hours this week");
  const before = (await weekHours.textContent())?.trim();

  await page.goto("/settings");
  await expect(page.getByText("Unlocked week totals regroup when you change this.")).toBeVisible();
  await page.getByLabel("Week starts").selectOption("0");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/time");
  await expect(page.getByText("The week starts Sunday")).toBeVisible();
  const after = (await weekHours.textContent())?.trim();
  expect([before, after].sort()).toEqual(["0h 00m", "4h 00m"]);
  expect(before).not.toBe(after);
  await expect(page.getByText("$390.00").first()).toBeVisible();
  await expect(page.getByText("5200")).toHaveCount(0);
});
