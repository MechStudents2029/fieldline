import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
}

test.describe("overtime, burden, and non-job time", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("saves overtime settings", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/settings");
    await page.locator("a[href='/settings/time']").click();
    await expect(page).toHaveURL(/\/settings\/time/);
    await expect(page.getByRole("checkbox", { name: "Overtime" })).toBeChecked();
    await expect(page.getByLabel("Weekly overtime hours")).toHaveValue("40");
    await expect(page.getByLabel("Labor burden percent")).toHaveValue("12");
    await expect(page.getByLabel("Overtime multiplier")).toHaveValue("1.50");
    await expect(page.getByRole("checkbox", { name: "Sun" })).toBeChecked();
    await expect(page.getByLabel("Burden percent for Luis Ortega")).toHaveValue("18");
    await shot(page, "settings-time-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "settings-time-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByLabel("Double time hours").fill("12");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Time settings saved.");
    await page.reload();
    await expect(page.getByLabel("Double time hours")).toHaveValue("12");
    await expect(page.getByRole("checkbox", { name: "Overtime" })).toBeChecked();
  });

  test("shows the week split, adds PTO, and downloads payroll hours", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/time");
    const grid = page.locator("table").first();
    const luis = grid.getByRole("row", { name: /Luis Ortega/ });
    const sam = grid.getByRole("row", { name: /Sam Patel/ });
    await expect(luis.locator("td").nth(8)).toHaveText("44.0");
    await expect(luis.locator("td").nth(8)).toHaveClass(/mac-warning/);
    await expect(luis.locator("td").nth(9)).toHaveText("8.0");
    await expect(luis.locator("td").nth(10)).toHaveText("36.0");
    await expect(luis.locator("td").nth(10)).toHaveClass(/mac-warning/);
    await expect(luis.locator("td").nth(12)).toHaveText("—");
    await expect(luis.locator("td").nth(13)).toContainText("3,292.20");
    await expect(sam.locator("td").nth(10)).toHaveText("4.0");
    await expect(sam.locator("td").nth(12)).toHaveText("8.0");
    await sam.click();
    await expect(page.getByRole("cell", { name: "General" })).toBeVisible();
    await shot(page, "time-week-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "time-week-dark");
    await page.emulateMedia({ colorScheme: "light" });

    await page.getByLabel("PTO person").selectOption({ label: "Luis Ortega" });
    await page.getByRole("button", { name: "Add PTO" }).click();
    await expect(page.getByRole("status")).toHaveText("PTO added.");
    await expect(luis.locator("td").nth(12)).toHaveText("8.0");
    await expect(luis.locator("td").nth(10)).toHaveText("36.0");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
    expect(download.suggestedFilename()).toBe("fieldline-time.csv");
    const csv = fs.readFileSync(await download.path(), "utf8");
    expect(csv.split("\n")[0]).toBe("date,name,email,job,cost_code,shift,regular_hours,ot_hours,dt_hours,pto_hours");
    expect(csv).toContain("Luis Ortega");
    expect(csv).toMatch(/Luis Ortega,[^,]+,[^,]+,FRM-LABOR,regular,8\.00,36\.00,0\.00,0\.00/);
    expect(csv).toMatch(/Sam Patel,[^,]+,General,PTO,pto,0\.00,0\.00,0\.00,8\.00/);
    expect(csv).toMatch(/summary,Luis Ortega,[^,]+,,,,8\.00,36\.00,0\.00,8\.00/);
    expect(csv).not.toMatch(/\$|wage|stripe/i);
  });

  test("opens the labor cost report", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/reports");
    await expect(page.locator("[data-mac-list]").getByRole("link", { name: "Labor cost" })).toBeVisible();
    await page.goto("/reports/builtin/labor_cost");
    await expect(page.getByRole("heading", { name: "Labor cost" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "OT share" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Luis Ortega" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "36h 00m" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "General" })).toBeVisible();
    await shot(page, "labor-cost-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "labor-cost-dark");
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("lets a field login see their own split and not the cost", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto("/login");
    await page.getByLabel("Email").fill("dana@rivera.demo");
    await page.getByLabel("Password").fill("demo");
    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
    await page.goto("/time");
    await expect(page.getByLabel("Regular hours")).toBeVisible();
    await expect(page.getByLabel("Overtime hours")).toBeVisible();
    await expect(page.getByText("Labor cost")).toHaveCount(0);
    await expect(page.getByText("Burden")).toHaveCount(0);
    await expect(page.getByLabel("Download CSV")).toHaveCount(0);
    await page.goto("/settings/time");
    await expect(page.getByText("Only an owner or admin can change these.")).toBeVisible();
  });
});
