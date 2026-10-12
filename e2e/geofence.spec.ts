import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

async function closeOpenShift(page: import("@playwright/test").Page) {
  await page.goto("/time");
  const clockOut = page.getByRole("button", { name: "Clock out" });
  if (await clockOut.isVisible()) {
    await clockOut.click();
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
  }
}

test.describe("job-site geofence", () => {
  test.use({ permissions: ["geolocation"] });

  test("keeps an in-fence punch clear and still saves an outside punch", async ({ page, request, context }) => {
    await resetDemo(request);
    await context.setGeolocation({ latitude: 37.7994, longitude: -122.247, accuracy: 12 });
    await signInAs(page, "dana@rivera.demo");
    await closeOpenShift(page);
    await page.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
    await page.getByLabel("Cost code").selectOption("TILE-SHOWER");
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText(/Clocked in on Okonkwo primary bath/)).toBeVisible();
    await page.getByLabel("Clock-out note").fill("Inside the fence");
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
    const inside = page.getByRole("listitem").filter({ hasText: "Inside the fence" });
    await expect(inside.getByText("Outside")).toHaveCount(0);
    await expect(inside.getByText("No location")).toHaveCount(0);

    await context.setGeolocation({ latitude: 37.81, longitude: -122.247, accuracy: 12 });
    await page.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
    await page.getByLabel("Cost code").selectOption("TILE-SHOWER");
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText(/Clocked in on Okonkwo primary bath/)).toBeVisible();
    await page.getByLabel("Clock-out note").fill("Past the fence");
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
    const outside = page.getByRole("listitem").filter({ hasText: "Past the fence" });
    await expect(outside.getByText(/Outside/)).toBeVisible();
  });

  test("an approver overrides the flag with a reason", async ({ page, request, context }) => {
    await resetDemo(request);
    await context.setGeolocation({ latitude: 37.81, longitude: -122.247, accuracy: 12 });
    await signInAs(page, "dana@rivera.demo");
    await closeOpenShift(page);
    await page.getByLabel("Job").selectOption({ label: "Okonkwo primary bath" });
    await page.getByLabel("Cost code").selectOption("TILE-SHOWER");
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText(/Clocked in on Okonkwo/)).toBeVisible();
    await page.getByLabel("Clock-out note").fill("Yard run");
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Yard run" }).getByText(/Outside/)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await signInAs(page, "maya@rivera.demo");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/time");
    const row = page.getByRole("row").filter({ hasText: "Yard run" });
    await expect(row.locator(".fl-pill", { hasText: /^Outside/ })).toBeVisible();
    await row.getByLabel("Override reason").fill("Yard pickup approved");
    await row.getByRole("button", { name: "Override" }).click();
    await expect(row.getByText("Overridden")).toBeVisible();
    await expect(row.getByText("Yard pickup approved")).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/geofence-time.png", fullPage: false });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "/opt/cursor/artifacts/geofence-time-dark.png", fullPage: false });
    await page.goto("/projects/proj_okonkwo");
    await expect(page.getByLabel("Latitude")).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/geofence-pin.png", fullPage: false });
  });
});

test.describe("offline geofence", () => {
  test.use({ permissions: ["geolocation"], viewport: { width: 393, height: 851 } });

  test("evaluates an offline punch when it syncs", async ({ page, request, context }) => {
    await resetDemo(request);
    await context.setGeolocation({ latitude: 37.7994, longitude: -122.247, accuracy: 12 });
    await signInAs(page, "dana@rivera.demo");
    await page.goto("/time");
    await closeOpenShift(page);
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration?.active) return false;
      const cache = await caches.open("fieldline-shell-v2");
      const offline = await cache.match("/offline");
      if (!offline) return false;
      const keys = await cache.keys();
      return keys.some((key) => key.url.includes("/_next/static/") && key.url.endsWith(".js"));
    });
    await context.setGeolocation({ latitude: 37.82, longitude: -122.247, accuracy: 12 });
    await context.setOffline(true);
    await page.goto("/time");
    await expect(page).toHaveURL(/\/offline/);
    await page.getByRole("combobox", { name: "Job", exact: true }).selectOption({ label: "Okonkwo primary bath" });
    await page.getByRole("combobox", { name: "Cost code", exact: true }).selectOption("TILE-SHOWER");
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText("Saved on this phone, will sync").first()).toBeVisible();
    await page.getByLabel("Clock-out note").fill("Offline outside");
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByText("2 saved on this phone, will sync")).toBeVisible();
    await context.setOffline(false);
    const sync = page.getByRole("button", { name: "Sync now" });
    await expect(sync).toBeVisible();
    await sync.evaluate((node: HTMLButtonElement) => node.click());
    await expect(page.getByText("2 saved on this phone, will sync")).toHaveCount(0);
    await page.goto("/time");
    await expect(page.getByRole("listitem").filter({ hasText: "Offline outside" }).getByText(/Outside/)).toBeVisible();
  });
});
