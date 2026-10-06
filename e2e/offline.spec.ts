import { devices, expect, test } from "@playwright/test";

import { resetDemo } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test.describe("offline clock", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("clocks in offline and syncs the capture time once", async ({ page, request, context }) => {
    await resetDemo(request);
    await signInAs(page, "dana@rivera.demo");
    await page.goto("/time");
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
    await page.getByLabel("Clock-out note").fill("Closed before offline");
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration?.active) return false;
      const cache = await caches.open("fieldline-shell-v2");
      const offline = await cache.match("/offline");
      if (!offline) return false;
      const keys = await cache.keys();
      return keys.some((key) => key.url.includes("/_next/static/") && key.url.endsWith(".js"));
    });
    await page.waitForFunction(async () => {
      const rows = await new Promise<{ open: unknown }[]>((resolve, reject) => {
        const request = indexedDB.open("fieldline-offline");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("bootstrap").objectStore("bootstrap").getAll();
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result as { open: unknown }[]);
        };
      });
      return rows.some((row) => row.open == null);
    });

    const captured = Date.now();
    await page.clock.install({ time: captured });
    await context.setOffline(true);
    await page.goto("/time");
    await expect(page).toHaveURL(/\/offline/);
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
    await expect(page.getByText("$")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Job", exact: true }).selectOption({ label: "Okonkwo primary bath" });
    await page.getByRole("combobox", { name: "Cost code", exact: true }).selectOption("TILE-SHOWER");
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText("Saved on this phone, will sync").first()).toBeVisible();
    const note = "Offline niche set";
    await page.getByLabel("Clock-out note").fill(note);
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByText("2 saved on this phone, will sync")).toBeVisible();
    await expect(page.getByText(note)).toBeVisible();

    const expected = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(captured);
    const drifted = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(captured + 10 * 60 * 1000);
    await page.clock.fastForward(10 * 60 * 1000);
    await context.setOffline(false);
    const sync = page.getByRole("button", { name: "Sync now" });
    await expect(sync).toBeVisible();
    await sync.evaluate((node: HTMLButtonElement) => node.click());
    await expect(page.getByText("2 saved on this phone, will sync")).toHaveCount(0);
    await page.goto("/time");
    await expect(page.getByText(note)).toHaveCount(1);
    await expect(page.getByText(expected).first()).toBeVisible();
    if (drifted !== expected) await expect(page.getByText(drifted)).toHaveCount(0);
    await expect(page.getByText("$")).toHaveCount(0);
  });
});
