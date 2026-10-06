import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  const field = page.getByLabel("Email");
  if (!(await field.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }
  await field.fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test("office punch, closeout, and warranty at 1440", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, "maya@rivera.demo");
  await expect(page.locator("a:visible", { hasText: "Warranty requests" })).toHaveCount(1);
  await expect(page.locator("a:visible", { hasText: "Warranty requests" })).toContainText("1");
  await expect(page.locator("a:visible", { hasText: "Floor tile" })).toHaveCount(1);

  await page.goto("/projects/proj_okonkwo");
  await expect(page.getByRole("heading", { name: "Okonkwo primary bath" })).toBeVisible();
  await expect(page.locator("[data-count=open]")).toHaveText("3");
  await expect(page.locator("[data-count=done]")).toHaveText("1");
  await expect(page.locator("[data-count=verified]")).toHaveText("1");
  await page.getByLabel("Item").fill("Reset the GFCI");
  await page.getByLabel("Room").fill("Bath");
  await page.getByRole("button", { name: "Add punch" }).click();
  await expect(page.getByText("Reset the GFCI", { exact: true })).toBeVisible();
  await expect(page.locator("[data-count=open]")).toHaveText("4");
  await page.getByRole("button", { name: "Verify Touch up the ceiling" }).click();
  await expect(page.locator("[data-count=done]")).toHaveText("0");
  await expect(page.locator("[data-count=verified]")).toHaveText("2");
  await expect(page.locator("[data-blocker=punch]")).toContainText("4");
  await expect(page.locator("[data-blocker=invoice]")).toContainText("1");
  await page.getByRole("button", { name: "Substantial" }).click();
  await expect(page.getByText("Substantial", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close job" }).click();
  await expect(page.getByText("Clear the blockers, or add a reason.")).toBeVisible();

  await page.goto("/projects/proj_diaz#warranty");
  await expect(page.getByRole("heading", { name: "Diaz deck replacement" })).toBeVisible();
  await expect(page.getByText("Loose deck board", { exact: true })).toBeVisible();
  await expect(page.locator("[data-blocker=punch] dd")).toHaveText("0");
  const today = await page.locator("#punch").getAttribute("data-today");
  await page.getByLabel("Assign").selectOption({ label: "Dana Cho" });
  await page.getByLabel("Visit").fill(today || "");
  await page.getByRole("button", { name: "Schedule Loose deck board" }).click();
  await expect(page.getByLabel("Visit note Loose deck board")).toHaveValue(/Loose deck board/);
  await page.getByRole("textbox", { name: "Note Loose deck board", exact: true }).fill("Replaced the board.");
  await page.getByRole("button", { name: "Resolve Loose deck board" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByText("Replaced the board.")).toBeVisible();
});

test.describe("field punch and portal warranty", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("Dana marks a punch item done", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
    await expect(page.getByText("$")).toHaveCount(0);
    const row = page.locator("li", { hasText: "Caulk the curb" });
    await row.getByLabel("After photo Caulk the curb").setInputFiles({ name: "curb.png", mimeType: "image/png", buffer: png });
    await row.getByRole("button", { name: "Mark Caulk the curb done" }).click();
    await expect(row.locator(".fl-footnote")).toContainText("Done");
  });

  test("homeowner sends a warranty request", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto("/portal/demo_portal_diaz");
    await expect(page.getByRole("heading", { name: "Diaz deck replacement" })).toBeVisible();
    await expect(page.locator("[data-warranty=open]")).toBeVisible();
    await expect(page.locator("[data-warranty-end]")).toBeVisible();
    await expect(page.getByText("Tighten the rail")).toBeVisible();
    await expect(page.getByText("Loose deck board")).toBeVisible();
    const warranty = page.getByRole("region", { name: "Warranty" });
    await expect(warranty.getByText("$")).toHaveCount(0);
    await warranty.getByLabel("Title").fill("Squeaky stair");
    await warranty.getByLabel("Description").fill("The third tread squeaks.");
    await warranty.getByLabel("Photo").setInputFiles({ name: "stair.png", mimeType: "image/png", buffer: png });
    await page.waitForTimeout(3200);
    await warranty.getByRole("button", { name: "Send request" }).click();
    const sent = page.locator("li", { hasText: "Squeaky stair" });
    await expect(sent).toContainText("Submitted");
  });
});
