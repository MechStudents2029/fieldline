import { expect, test } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

test("handover package publishes to the homeowner and a warranty request can name the item", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await revealToday(page, "Care due");
  await expect(page.locator("a:visible", { hasText: "Care due" })).toContainText("1");

  await page.goto("/projects/proj_okonkwo/handover");
  await page.getByRole("button", { name: "Start package" }).click();
  await expect(page.getByRole("heading", { name: "Okonkwo primary bath" })).toBeVisible();

  const installed = page.locator("[data-section=installed]");
  await installed.getByLabel("Title").fill("E2E valve");
  await installed.getByRole("button", { name: "Add item" }).click();
  const item = installed.locator("[data-item='E2E valve']");
  await expect(item).toContainText("Missing doc");
  await expect(page.locator("[data-readiness='1']")).toBeVisible();

  await item.getByLabel("Manual E2E valve").selectOption("doc_ok_a101_r2");
  await item.getByRole("button", { name: "Attach" }).click();
  await expect(page.locator("[data-readiness='0']")).toBeVisible();

  await page.getByRole("button", { name: "Ready" }).click();
  await expect(page.locator("[data-status=ready]")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

  await page.goto("/portal/demo_portal_okonkwo");
  await expect(page.getByRole("region", { name: "Handover" })).toContainText("E2E valve");

  await page.goto("/handover");
  await page.getByRole("link", { name: "Okonkwo primary bath" }).click();
  await page.getByRole("link", { name: "Print" }).click();
  await expect(page.getByRole("heading", { name: "Okonkwo primary bath" })).toBeVisible();
  await expect(page.getByText("901 Mandana Blvd, Oakland, CA")).toBeVisible();

  await page.goto("/portal/demo_portal_diaz");
  const warranty = page.getByRole("region", { name: "Warranty" });
  await warranty.getByLabel("Item").selectOption({ label: "HVAC filter" });
  await warranty.getByLabel("Title").fill("E2E loose board");
  await warranty.getByLabel("Description").fill("The filter housing rattles.");
  await warranty.getByLabel("Photo").setInputFiles({ name: "board.png", mimeType: "image/png", buffer: png });
  await page.waitForTimeout(3200);
  await warranty.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator("li", { hasText: "E2E loose board" })).toContainText("Submitted");

  await page.goto("/projects/proj_diaz#warranty");
  await expect(page.locator("li", { hasText: "E2E loose board" })).toContainText("HVAC filter");
});
