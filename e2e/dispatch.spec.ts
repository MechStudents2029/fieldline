import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

const SPAN = 11 * 60;

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

async function dragToMinute(page: Page, card: Locator, slot: Locator, minutesFromSeven: number) {
  const from = await card.boundingBox();
  const box = await slot.boundingBox();
  if (!from || !box) throw new Error("missing slot");
  const y = (box.height * minutesFromSeven) / SPAN;
  await page.mouse.move(from.x + from.width / 2, from.y + Math.min(12, from.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + y, { steps: 12 });
  await page.mouse.up();
}

test("assign from open, block the overlap, then move the card", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/dispatch");
  const main = page.locator("#main");
  await expect(main.getByRole("heading", { name: "Dispatch" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Prev" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Next" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("input[type=date]")).toHaveCount(0);
  await expect(page.locator("input[type=time]")).toHaveCount(0);
  const open = page.getByRole("complementary", { name: "Open" });
  const coil = open.getByRole("button", { name: "Coil visit" });
  const dana = page.getByRole("region", { name: "Dana Cho" });
  await expect(coil).toBeVisible();
  await expect(dana.getByRole("button", { name: "Tile shower" })).toBeVisible();
  await expect(dana.getByText("1h booked")).toBeVisible();
  const listed = (await open.getByRole("heading").innerText()).replace(/\D/g, "");
  await expect(page.locator("[data-bar=toolbar] p")).toHaveText(`${listed} open`);
  await expect(open.getByText(/Oct \d+/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Luis Ortega" }).getByRole("button", { name: "Framing walk" })).toBeVisible();
  await shot(page, "dispatch-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "dispatch-dark");
  await page.emulateMedia({ colorScheme: "light" });

  const slot = dana.locator("[data-slot]");
  await dragToMinute(page, coil, slot, 30);
  await expect(main.getByRole("alert")).toHaveText(/Overlaps Tile shower/);
  await expect(open.getByRole("button", { name: "Coil visit" })).toBeVisible();

  await dragToMinute(page, open.getByRole("button", { name: "Coil visit" }), slot, 180);
  const placed = dana.getByRole("button", { name: "Coil visit" });
  await expect(placed).toBeVisible();
  await expect(open.getByRole("button", { name: "Coil visit" })).toHaveCount(0);

  await placed.click();
  const dialog = page.getByRole("dialog", { name: "Coil visit" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Start").fill("15:00");
  await dialog.getByLabel("End").fill("16:00");
  await dialog.getByLabel("Tech").selectOption({ label: "Luis Ortega" });
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("region", { name: "Luis Ortega" }).getByRole("button", { name: "Coil visit" })).toBeVisible();
  await page.goto("/");
  await revealToday(page, "Unassigned today");
  await expect(page.locator("a:visible", { hasText: "Unassigned today" })).toBeVisible();
});
