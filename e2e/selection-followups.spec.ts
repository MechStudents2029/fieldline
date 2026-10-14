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

test("overdue selection follow-up is ready to copy, not emailed", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  await page.goto("/settings/selections");
  await expect(page.getByLabel("Days before")).toHaveValue("3");
  await expect(page.getByLabel("Days after")).toHaveValue("0");
  await expect(page.getByLabel("Message")).toHaveValue(/\{selection\}/);
  await shot(page, "selfollow-settings-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selfollow-settings-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/selection-followups");
  await expect(page.getByRole("link", { name: "Floor tile" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vanity" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "CSV" }).first()).toHaveAttribute("href", /\/api\/export\/selection-followups/);
  await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send SMS" })).toHaveCount(0);
  await shot(page, "selfollow-list-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selfollow-list-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  const more = page.locator("details[data-today-more]:visible");
  await more.locator("summary").click();
  await expect(more.getByRole("link", { name: "Due selections" })).toBeVisible();
  await shot(page, "selfollow-today-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selfollow-today-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/portal/demo_portal_okonkwo");
  await expect(page.getByTestId("selection-due").first()).toBeVisible();
  await shot(page, "selfollow-portal-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selfollow-portal-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/selection-followups/sfol_ok_floor");
  await expect(page.getByLabel("Selection link")).toHaveValue(/#selection-sel_ok_floor/);
  await expect(page.getByLabel("Follow-up message")).toHaveValue(/Amara Okonkwo/);
  await expect(page.getByLabel("Follow-up message")).toHaveValue(/Floor tile/);
  await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Copied", { exact: true }).first()).toBeVisible();
  await shot(page, "selfollow-detail-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "selfollow-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill("dana@rivera.demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
  await page.goto("/settings/selections");
  await expect(page.getByText("Only an owner or admin can change selection follow-ups.")).toBeVisible();
});
