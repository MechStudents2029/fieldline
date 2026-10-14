import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday, signIn } from "./helpers";

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

test("book a service call and see it on dispatch", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/book/demo_booking_rivera");
  await expect(page.getByRole("heading", { name: "Rivera Remodeling & Trade" })).toBeVisible();
  await page.getByRole("link", { name: /Service call/ }).click();
  await page.getByTestId("booking-days").getByRole("link").first().click();
  await page.getByTestId("booking-slots").getByRole("link").first().click();
  await page.getByLabel("Name").fill("Ava Moss");
  await page.getByLabel("Phone").fill("(510) 555-0198");
  await page.getByLabel("Email").fill("ava.moss.book@example.com");
  await page.getByLabel("Gate code").fill("2214");
  await shot(page, "booking-public-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "booking-public-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Book" }).click();
  const done = page.getByTestId("booking-done");
  await expect(done).toContainText("Dana Cho");
  const text = await done.innerText();
  const day = text.match(/Booked (\d{4}-\d{2}-\d{2})/)?.[1];
  if (!day) throw new Error(`No day in ${text}`);

  await signIn(page);
  await page.goto("/settings/booking");
  await expect(page.getByLabel("Booking link")).toHaveValue(/\/book\/demo_booking_rivera$/);
  await expect(page.getByTestId("bookable-services")).toContainText("Service call");
  await shot(page, "booking-settings-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "booking-settings-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto(`/dispatch?on=${day}`);
  const booked = page.getByRole("region", { name: "Dana Cho" }).getByRole("button", { name: "Service call" });
  await booked.scrollIntoViewIfNeeded();
  await expect(booked).toBeVisible();
  await expect(booked).toContainText("Ava Moss");
  await shot(page, "booking-dispatch-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "booking-dispatch-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/");
  await revealToday(page, "Online booking");
  await expect(page.getByRole("link", { name: /^Online booking/ })).toBeVisible();
});
