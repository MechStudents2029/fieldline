import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function headersFit(page: Page) {
  const boxes = await page.locator("table[aria-label='To-dos'] th").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, right: box.right };
    }),
  );
  expect(boxes.length).toBeGreaterThan(3);
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    if (!previous || !current) continue;
    expect(current.x).toBeGreaterThanOrEqual(previous.right - 1);
  }
  const job = page.locator("table[aria-label='To-dos'] td.clip").first();
  await expect(job).toHaveCSS("white-space", "nowrap");
  await expect(job).toHaveCSS("text-overflow", "ellipsis");
  await expect(job).toHaveAttribute("title", /.+/);
}

test.describe("list toolbar on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("filters without Show, pins a view, and edits a checklist inline", async ({ page, request }) => {
    await resetDemo(request);
    await signIn(page);
    await page.goto("/todos");
    await expect(page.getByRole("button", { name: "Show" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter" })).toHaveCount(0);
    await page.getByLabel("Priority").selectOption("high");
    await expect(page).toHaveURL(/priority=high/);
    await expect(page.getByRole("link", { name: "Pre-drywall walk" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Order the niche tile for Okonkwo" })).toHaveCount(0);
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByLabel("View name").fill("High open");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/view=/);
    await expect(page.getByRole("button", { name: "Saved views" })).toHaveText("High open");
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "views-menu-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "views-menu-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("button", { name: "Pin" }).click();
    await page.goto("/todos");
    await expect(page).toHaveURL(/priority=high/);
    await page.getByRole("link", { name: "Pre-drywall walk" }).click();
    const pane = page.getByRole("complementary", { name: "To-do" });
    await expect(pane.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(pane.getByRole("button", { name: "Save" })).toHaveCount(0);
    await pane.getByRole("button", { name: "Edit Water lines capped" }).click();
    const title = pane.getByLabel("Item title");
    await title.fill("Water lines closed");
    await title.press("Escape");
    await expect(pane.getByRole("button", { name: "Edit Water lines capped" })).toBeVisible();
    await pane.getByRole("button", { name: "Edit Water lines capped" }).click();
    await pane.getByLabel("Item title").fill("Water lines closed");
    await pane.getByLabel("Item title").press("Enter");
    await expect(pane.getByText("Water lines closed")).toBeVisible();
    await headersFit(page);
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "todos-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "todos-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await headersFit(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/rfis");
    await expect(page.getByRole("button", { name: "Filter" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Saved views" })).toHaveText("Views");
    await page.getByLabel("Status").selectOption("open");
    await expect(page).toHaveURL(/status=open/);
    await expect(page.getByRole("cell", { name: "Valve height" })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "rfis-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "rfis-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/bills");
    await expect(page.getByRole("button", { name: "Filter" })).toHaveCount(0);
    await page.getByLabel("Status").selectOption("overdue");
    await expect(page).toHaveURL(/status=overdue/);
    await expect(page.getByRole("link", { name: /BE-77/ })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await shot(page, "bills-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "bills-dark");
  });
});

test.describe("list toolbar on a phone", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("opens one Filter button instead of a stack", async ({ page, request }) => {
    await resetDemo(request);
    await page.goto("/login");
    await page.getByLabel("Email").fill("dana@rivera.demo");
    await page.getByLabel("Password").fill("demo");
    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
    await page.goto("/todos");
    await expect(page.getByRole("button", { name: "Show" })).toHaveCount(0);
    const filter = page.getByRole("button", { name: "Filter" });
    await expect(filter).toBeVisible();
    await expect(page.getByLabel("Due")).toBeHidden();
    await filter.click();
    const stacked = await page.locator("select").evaluateAll((nodes) => {
      const visible = nodes.filter((node) => node.getBoundingClientRect().height > 0);
      if (visible.length < 2) return false;
      const first = visible[0]?.getBoundingClientRect();
      const second = visible[1]?.getBoundingClientRect();
      if (!first || !second) return false;
      return second.top >= first.bottom - 1 && first.width > 280 && second.width > 280;
    });
    expect(stacked).toBe(false);
    await page.getByLabel("Due").selectOption("overdue");
    await expect(page).toHaveURL(/due=overdue/);
  });
});
