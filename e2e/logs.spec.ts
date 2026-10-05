import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: /Today|My day/ })).toBeVisible();
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

test("a field log reaches the portal without hours or cost", async ({ page, request }) => {
  await resetDemo(request);
  await signInAs(page, "dana@rivera.demo");
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await expect(page.getByText("$")).toHaveCount(0);
  await page.getByRole("button", { name: /today's log/ }).click();
  await expect(page.getByRole("heading", { name: "Daily log" })).toBeVisible();
  await expect(page.getByText("$")).toHaveCount(0);
  await page.getByLabel("Notes").fill("Niche tile is set and the curb is dry.");
  await page.getByText("Weather, delays, and the rest").click();
  await page.getByLabel("Delay cause").fill("Inspector held the rough-in");
  await page.getByLabel("Safety note").fill("Cones at the curb");
  await page.getByLabel("Add a log photo").setInputFiles({ name: "niche.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Add a log photo caption").fill("Niche curb");
  await page.getByRole("button", { name: "Save photo on the log" }).click();
  await expect(page.getByText("Photo added to the log.")).toBeVisible();
  await page.getByRole("button", { name: "Publish log" }).click();
  await expect(page.getByText(/· published ·/)).toBeVisible();
  const logUrl = page.url();

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page);
  await page.goto(logUrl);
  await page.getByRole("button", { name: "Show on the client portal" }).click();
  await expect(page.getByText("On the client portal. Nothing was emailed.")).toBeVisible();
  await page.goto("/portal/demo_portal_okonkwo");
  const entry = page.getByRole("article").filter({ hasText: "Niche tile is set and the curb is dry." });
  await expect(entry).toBeVisible();
  await expect(entry.getByText("Niche curb")).toBeVisible();
  await expect(entry.getByText("Inspector held the rough-in")).toHaveCount(0);
  await expect(entry.getByText("Cones at the curb")).toHaveCount(0);
  await expect(entry.getByText("Dana")).toHaveCount(0);
  await expect(entry.getByText("$")).toHaveCount(0);
  await expect(entry.getByText(/GC-SUPER|TILE-SHOWER/)).toHaveCount(0);
});

test.describe("phone my day", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("the clock and today's log sit in the phone viewport", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    const clock = page.getByRole("button", { name: "Clock out" });
    const log = page.getByRole("button", { name: /today's log/ });
    await expect(clock).toBeInViewport();
    await expect(log).toBeInViewport();
    await expect(page.getByText("$")).toHaveCount(0);
  });
});
