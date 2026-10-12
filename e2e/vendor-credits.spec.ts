import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const portal = "/v/demo_vendor_harbor_m3p8qx7k";

function shot(page: Page, name: string, fullPage = false) {
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  return page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage });
}

async function pair(page: Page, name: string, fullPage = false) {
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, name, fullPage);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, `${name}-dark`, fullPage);
  await page.emulateMedia({ colorScheme: "light" });
}

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  const field = page.getByLabel("Email");
  if (!(await field.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }
  await field.fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Today|My day/ })).toBeVisible();
}

test("create a backcharge from a damaged receipt once", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/purchase-orders/po_ok_harbor");
  await page.getByRole("button", { name: "Receive" }).click();
  const sheet = page.getByRole("dialog", { name: "Receive" });
  await sheet.getByLabel("Qty Valve, trim, and remaining rough").fill("0.5");
  await sheet.getByLabel("Condition Valve, trim, and remaining rough").selectOption("damaged");
  await sheet.getByRole("button", { name: "Save receipt" }).click();
  await expect(sheet.getByRole("status")).toContainText("PO-1044 received");
  await page.goto("/purchase-orders/po_ok_harbor");
  const damaged = page.locator("section[aria-label=Receipts] li", { hasText: "damaged" });
  await damaged.getByRole("button", { name: "Backcharge" }).click();
  await expect(page.getByRole("heading", { name: "BC-1048" })).toBeVisible();
  await expect(page.getByText("$500.00").first()).toBeVisible();
  const creditUrl = page.url();
  await page.goto("/projects/proj_okonkwo");
  await expect(page.locator("[data-code=PLB-SHOWER] [data-kind=actual]")).toHaveText("$3,120");
  await page.goto("/purchase-orders/po_ok_harbor");
  await page.locator("section[aria-label=Receipts] li", { hasText: "damaged" }).getByRole("button", { name: "Backcharge" }).click();
  await expect(page).toHaveURL(creditUrl);
  await page.goto("/projects/proj_okonkwo");
  await expect(page.locator("[data-code=PLB-SHOWER] [data-kind=actual]")).toHaveText("$3,120");
});

test("applying a credit pays only the net", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/bills/bill_ok_ret_ready");
  await expect(page.getByRole("heading", { name: "HP-510" })).toBeVisible();
  await page.getByRole("button", { name: "Pay" }).click();
  const sheet = page.getByRole("dialog", { name: "Pay" });
  await sheet.getByLabel("Apply BC-1044").fill("100");
  await sheet.getByLabel("Payment reference").fill("7701");
  await expect(sheet.locator("[data-net-paid]")).toHaveAttribute("data-net-paid", "170000");
  await sheet.scrollIntoViewIfNeeded();
  await page.emulateMedia({ colorScheme: "light" });
  await sheet.screenshot({ path: "/opt/cursor/artifacts/pay-credits.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await sheet.screenshot({ path: "/opt/cursor/artifacts/pay-credits-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await sheet.getByLabel("Apply BC-1044").fill("1900");
  await sheet.getByRole("button", { name: "Mark paid" }).click();
  await expect(sheet.getByRole("alert")).toContainText(/more than the net/);
  await sheet.getByLabel("Apply BC-1044").fill("100");
  await sheet.getByLabel("Payment reference").fill("7701");
  await sheet.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.locator("[data-detail=header] .fl-pill")).toHaveText("Paid");
  const facts = page.locator("[aria-label='Bill']");
  await expect(facts.getByText("$100.00")).toBeVisible();
  await expect(facts.getByText("$1,700.00")).toBeVisible();
});

test("a vendor can dispute a credit into the office inbox", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await page.goto(portal);
  const credits = page.getByRole("region", { name: "Credits" });
  await credits.scrollIntoViewIfNeeded();
  await expect(credits.getByText("BC-1044")).toBeVisible();
  await expect(credits.getByText("Short one pallet")).toBeVisible();
  await expect(credits.getByRole("link", { name: "Photo" })).toBeVisible();
  await pair(page, "portal-credits", true);
  const card = credits.locator("li", { hasText: "BC-1045" });
  await card.getByLabel("Dispute BC-1045").fill("The escutcheon was already replaced");
  await card.getByRole("button", { name: "Dispute" }).click();
  await expect(card.locator(".fl-pill")).toHaveText("Disputed");
  await expect(card).toContainText("The escutcheon was already replaced");
  await signIn(page);
  await page.goto("/inbox");
  await expect(page.getByText("BC-1045 disputed. The escutcheon was already replaced")).toBeVisible();
});

test("voiding an unapplied credit puts the job cost back", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await page.goto("/projects/proj_okonkwo");
  await expect(page.locator("[data-code=PLB-SHOWER] [data-kind=actual]")).toHaveText("$3,620");
  await expect(page.getByText("$3,280.00 open")).toBeVisible();
  await page.goto("/vendor-credits/vc_punch");
  await expect(page.getByRole("heading", { name: "BC-1045" })).toBeVisible();
  await page.getByLabel("Void reason").fill("Vendor fixed the escutcheon");
  await page.getByRole("button", { name: "Void" }).click();
  await expect(page.locator("[data-detail=header] .fl-pill")).toHaveText("Void");
  await expect(page.locator("[aria-label='Credit']")).toContainText("Vendor fixed the escutcheon");
  await page.goto("/projects/proj_okonkwo");
  await expect(page.locator("[data-code=PLB-SHOWER] [data-kind=actual]")).toHaveText("$3,800");
  await expect(page.getByText("$3,100.00 open")).toBeVisible();
});

test("vendor credits list, detail, and a field draft", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetDemo(request);
  await signIn(page);
  await expect(page.locator('a[href="/vendor-credits?attention=1"]:visible')).toBeVisible();
  await page.goto("/vendor-credits");
  await expect(page.getByRole("heading", { name: "Vendor credits" })).toBeVisible();
  await expect(page.getByText("4 credits").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Vendor credits" })).toContainText("BC-1046");
  await pair(page, "credits-list");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/vendor-credits");
    return { status: response.status, text: await response.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.text).toContain("BC-1044");
  expect(csv.text).toContain("Short one pallet");
  await page.goto("/vendor-credits/vc_short");
  await expect(page.getByText("Short one pallet")).toBeVisible();
  await expect(page.getByText("$2,500.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Photo" })).toBeVisible();
  await pair(page, "credit-detail", true);
  await page.goto("/contacts/c_harbor");
  await expect(page.getByRole("region", { name: "Credits" })).toContainText("3 open");
  await expect(page.getByRole("region", { name: "Credits" })).toContainText("$3,280.00");
  await signInAs(page, "dana@rivera.demo");
  await page.goto("/projects/proj_okonkwo/punch/punch_ok_esc");
  await expect(page.getByRole("heading", { name: "Replace the escutcheon" })).toBeVisible();
  await expect(page.getByLabel("Amount")).toHaveCount(0);
  await expect(page.getByText("$")).toHaveCount(0);
  await page.getByRole("button", { name: "Backcharge" }).click();
  await expect(page.getByRole("status")).toHaveText("Already proposed.");
  await expect(page.getByText("$")).toHaveCount(0);
});
