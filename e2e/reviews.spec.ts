import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

const GOOGLE = "https://search.google.com/local/writereview?placeid=ChIJdemoRiveraOakland";

async function shot(page: Page, name: string) {
  const buffer = await page.screenshot();
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const path = `/opt/cursor/artifacts/${name}.png`;
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.writeFileSync(path, buffer);
      return;
    } catch (error) {
      last = error;
      if (!String(error).includes("EIO")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw last;
}

test("review request is ready to copy, not emailed", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  await page.goto("/settings/reviews");
  await expect(page.getByLabel("Google review URL")).toHaveValue(GOOGLE);
  await expect(page.getByLabel("Timing")).toHaveValue("complete");
  await shot(page, "review-settings-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "review-settings-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/reviews");
  await expect(page.getByRole("link", { name: "Diaz deck replacement" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ready" })).toBeVisible();
  await shot(page, "review-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "review-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("link", { name: "Diaz deck replacement" }).click();
  await expect(page.getByLabel("Review link")).toHaveValue(GOOGLE);
  await expect(page.getByLabel("Review message")).toHaveValue(/Rosa Diaz/);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Copied", { exact: true }).first()).toBeVisible();
  await shot(page, "review-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "review-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/portal/demo_portal_diaz");
  const card = page.getByTestId("leave-review");
  await expect(card.getByRole("link", { name: "Leave a review" })).toHaveAttribute("href", GOOGLE);
  await shot(page, "review-portal-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "review-portal-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  await revealToday(page, "Review request");
  await expect(page.getByRole("link", { name: /Review request/ })).toBeVisible();
  await shot(page, "review-today-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "review-today-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await expect(page.getByTestId("ask-review")).toContainText("Diaz deck replacement");
});
