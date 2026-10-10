import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: import("@playwright/test").Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test("equipment register, checkout, a daily log tag, and a printed label", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(page.request);
  await signIn(page);

  await page.goto("/equipment");
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Track saw" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mud mixer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dump trailer" })).toBeVisible();
  await expect(page.getByText("1 overdue")).toBeVisible();
  await expect(page.getByLabel("Status")).toContainText("Status: Any");
  await expect(page.getByLabel("Location")).toContainText("Location: Any");
  await expect(page.getByRole("button", { name: "New" })).toBeVisible();
  const location = page.getByRole("cell", { name: "Diaz deck replacement · Dana Cho" });
  await expect(location).toBeVisible();
  const clipped = await location.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(false);
  await shot(page, "equipment-register-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "equipment-register-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("link", { name: "Mud mixer" }).click();
  const detail = page.getByRole("complementary", { name: "Mud mixer" });
  await expect(detail.getByRole("list", { name: "History" })).toContainText("Yard");
  await expect(detail.getByRole("list", { name: "History" })).toContainText("Okonkwo");
  await shot(page, "equipment-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "equipment-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  const overdue = page.getByRole("link", { name: "Overdue returns" });
  await overdue.scrollIntoViewIfNeeded();
  await expect(overdue).toBeVisible();
  await expect(page.getByRole("link", { name: "Service due" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Left on closed jobs" })).toBeVisible();
  await shot(page, "equipment-today-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await overdue.scrollIntoViewIfNeeded();
  await shot(page, "equipment-today-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/equipment?item=eq_laser");
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("complementary", { name: "Laser level" })).toContainText("On job");
  await expect(page.getByRole("complementary", { name: "Laser level" })).toContainText("Okonkwo");

  await page.goto("/equipment?item=eq_mixer");
  await page.getByRole("link", { name: "Check in" }).click();
  await page.getByLabel("Hours").fill("4");
  await page.getByLabel("Cost").fill("40.00");
  await page.getByRole("button", { name: "Save" }).click();
  const mixer = page.getByRole("complementary", { name: "Mud mixer" });
  await expect(mixer).toContainText("Available");
  await expect(mixer).toContainText("$40.00");

  await page.goto("/projects/proj_okonkwo/logs/log_ok_draft");
  await page.getByRole("checkbox", { name: /Track saw/ }).check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.goto("/equipment?item=eq_saw");
  await expect(page.getByRole("complementary", { name: "Track saw" })).toContainText("901 Mandana Blvd, Oakland, CA");

  const leaked: string[] = [];
  page.on("request", (request) => {
    if (/qrserver|chart\.googleapis|qrcode/.test(request.url())) leaked.push(request.url());
  });
  await page.goto("/equipment/labels");
  await expect(page.locator("article svg").first()).toBeVisible();
  await expect(page.getByText("T-101")).toBeVisible();
  await expect(page.getByText("Blower")).toHaveCount(0);
  expect(leaked).toEqual([]);
});
