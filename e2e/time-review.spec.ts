import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test.describe("mac time review", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("approves three submitted entries from the checkboxes", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/time");
    await expect(page.getByRole("button", { name: "Approve 3" })).toBeEnabled();
    await page.getByRole("checkbox", { name: "Select Set the curb" }).check();
    await page.getByRole("checkbox", { name: "Select Ran to the supplier" }).check();
    await page.getByRole("row", { name: /Sam Patel/ }).click();
    await page.getByRole("checkbox", { name: "Select Walked the powder room" }).check();
    await expect(page.getByText("· 3 selected")).toBeVisible();
    await page.getByRole("button", { name: "Approve selected" }).click();
    await expect(page.getByRole("button", { name: "Approve 0" })).toBeDisabled();
    await expect(page.getByRole("row", { name: /Dana Cho/ }).getByText("Approved")).toBeVisible();
  });

  test("edits an entry and saves it approved", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/time");
    const row = page.getByRole("row").filter({ hasText: "Ran to the supplier" });
    const clockIn = await row.getByLabel("Clock in").inputValue();
    const date = clockIn.slice(0, 10);
    await row.getByLabel("Clock in").fill(`${date}T21:00`);
    await row.getByLabel("Clock out").fill(`${date}T22:00`);
    await row.getByRole("textbox", { name: "Reason", exact: true }).fill("Corrected the supplier run");
    await row.getByRole("button", { name: "Save and approve" }).click();
    await expect(row.getByText("Approved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve 2" })).toBeEnabled();
  });

  test("approves from the keyboard and undoes it", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/");
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(page).toHaveURL(/\/time/);
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
    await page.getByRole("heading", { name: "Time" }).click();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("row", { selected: true })).toContainText("Luis Ortega");
    await page.keyboard.press("Meta+a");
    await expect(page.getByText("· 3 selected")).toBeVisible();
    await page.keyboard.press("Meta+Enter");
    await expect(page.getByRole("button", { name: "Approve 0" })).toBeDisabled();
    await page.keyboard.press("Meta+z");
    await expect(page.getByRole("button", { name: "Approve 3" })).toBeEnabled();
  });
});
