import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

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

test("overdue invoice follow-up is ready to copy, not emailed", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  await page.goto("/settings/collections");
  await expect(page.getByLabel("First reminder")).toHaveValue("3");
  await expect(page.getByLabel("Second reminder")).toHaveValue("14");
  await expect(page.getByLabel("Message")).toHaveValue(/\{invoice\}/);
  await shot(page, "collect-settings-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "collect-settings-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/collections");
  await expect(page.getByRole("link", { name: "RR-1019" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "RR-1008" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "CSV" }).first()).toHaveAttribute("href", /\/api\/export\/collections/);
  await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send SMS" })).toHaveCount(0);
  await shot(page, "collect-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "collect-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  const more = page.locator("details[data-today-more]");
  await more.locator("summary").click();
  await expect(more.getByRole("link", { name: "Collections" })).toBeVisible();
  await shot(page, "collect-today-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "collect-today-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/portal/demo_portal_diaz");
  await expect(page.getByTestId("pay-now").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Pay/ }).first()).toHaveAttribute("href", /demo_pay_diaz_final/);
  await shot(page, "collect-portal-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "collect-portal-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/collections/fol_diaz");
  await expect(page.getByLabel("Pay link")).toHaveValue(/demo_pay_diaz_final/);
  await expect(page.getByLabel("Follow-up message")).toHaveValue(/Rosa Diaz/);
  await expect(page.getByLabel("Follow-up message")).toHaveValue(/\$4,800\.00/);
  await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Copied", { exact: true }).first()).toBeVisible();
  await shot(page, "collect-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "collect-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await page.goto("/settings/collections");
  await expect(page.getByText("Only an owner or admin can change collections.")).toBeVisible();
});
