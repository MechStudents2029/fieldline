import { devices, expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("field clock-in becomes labor on the job after office approval", async ({ page, request }) => {
  await resetDemo(request);
  await signInAs(page, "dana@rivera.demo");
  await page.goto("/time");
  await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
  await expect(page.getByText("$")).toHaveCount(0);
  await page.getByLabel("Clock-out note").fill("Closed the open shift");
  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
  await expect(page.getByText("Closed the open shift")).toBeVisible();
  await page.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
  await page.getByLabel("Cost code").selectOption("TILE-SHOWER");
  await page.getByRole("button", { name: "Clock in" }).click();
  await expect(page.getByText(/Clocked in on Okonkwo primary bath/)).toBeVisible();
  await page.getByLabel("Clock-out note").fill("Set the niche");
  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
  await expect(page.getByText("Set the niche").first()).toBeVisible();
  await expect(page.getByText("Hourly cost")).toHaveCount(0);
  await expect(page.getByText("$")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await signInAs(page, "maya@rivera.demo");
  await page.goto("/time");
  const card = page.getByRole("article").filter({ hasText: "Set the niche" });
  await card.getByLabel("Clock in").fill("2026-10-04T14:00");
  await card.getByLabel("Clock out").fill("2026-10-04T16:00");
  await card.getByLabel("Break minutes").fill("0");
  await card.getByRole("textbox", { name: "Reason", exact: true }).fill("Corrected the niche set");
  await card.getByRole("button", { name: "Save time" }).click();
  await expect(card.getByText("Time updated.")).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("2h 00m · $104.00")).toBeVisible();

  await page.goto("/projects/proj_okonkwo");
  await expect(page.getByText("$104.00")).toBeVisible();
  await expect(page.getByText(/Dana Cho · TILE-SHOWER/).first()).toBeVisible();
});

test.describe("phone clock", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("the clock button sits in the phone viewport", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await page.goto("/time");
    const button = page.getByRole("button", { name: "Clock out" });
    await expect(button).toBeVisible();
    await expect(button).toBeInViewport();
    const box = await button.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });
});
