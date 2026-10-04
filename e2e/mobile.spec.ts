import { devices, expect, test } from "@playwright/test";
import { kitchenThroughPaid, resetDemo, signIn } from "./helpers";

test.use({ ...devices["Pixel 5"] });

test("the kitchen journey fits a phone", async ({ page, request }) => {
  await resetDemo(request);
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await kitchenThroughPaid(page);
  await expect(page.getByRole("button", { name: "Take a job photo" })).toBeVisible();
});
