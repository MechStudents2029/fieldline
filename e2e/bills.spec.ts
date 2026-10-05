import { devices, expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page.getByRole("heading", { name: /Today|My day/ })).toBeVisible();
}

function costDollars(text: string) {
  const match = text.match(/cost \$([\d,]+\.\d{2})/);
  if (!match) throw new Error(`No job cost in: ${text}`);
  return Number(match[1].replace(/,/g, ""));
}

test("office sees overdue bills and field and other companies do not", async ({ page, request }) => {
  await resetDemo(request);
  await signInAs(page, "maya@rivera.demo");
  await expect(page.getByRole("link", { name: /Overdue · BE-77/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Due soon · HP-441/ })).toBeVisible();
  await page.goto("/bills");
  await expect(page.getByRole("heading", { name: "Bills" })).toBeVisible();
  await expect(page.getByRole("link", { name: /BE-77 · Brighton Electric/ })).toBeVisible();
  await expect(page.getByText("· Overdue").first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signInAs(page, "dana@rivera.demo");
  await expect(page.getByRole("link", { name: "Bills", exact: true })).toHaveCount(0);
  await page.goto("/bills");
  await expect(page.getByText("Bills are for the office.")).toBeVisible();
  await expect(page.getByText("$")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();

  await signInAs(page, "jordan@northline.demo");
  await page.goto("/bills/bill_ok_harbor");
  await expect(page.getByRole("heading", { name: /Not in Northline/ })).toBeVisible();
  await expect(page.getByText("HP-441")).toHaveCount(0);
  await expect(page.getByText("$")).toHaveCount(0);
});

test.describe("phone bill", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("upload a bill, approve it onto the job, and mark it paid", async ({ page, request }) => {
    await resetDemo(request);
    await signInAs(page, "maya@rivera.demo");
    await page.goto("/projects/proj_okonkwo");
    const before = costDollars(await page.getByText(/cost \$/).innerText());
    await page.goto("/bills/new");
    await page.getByLabel("Job for this file").selectOption({ label: "Okonkwo primary bath" });
    await page.getByLabel("Upload a bill file").setInputFiles({
      name: "harbor-bill.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Vendor: Harbor Plumbing\nBill: HP-E2E-9\nDate: 2026-03-02\nDue: 2026-10-20\nSupply lines $400.00\nFittings $26.00\nTotal $426.00\n",
      ),
    });
    await page.getByRole("button", { name: "Read bill" }).click();
    await expect(page.getByText(/Read Harbor Plumbing/)).toBeVisible();
    await expect(page.getByLabel("Bill number")).toHaveValue("HP-E2E-9");
    await expect(page.getByLabel("Sub or vendor")).toHaveValue("c_harbor");
    await page.getByLabel("Line 1 cost code").fill("PLB-SHOWER");
    await page.getByLabel("Line 2 cost code").fill("PLB-SHOWER");
    const save = page.getByRole("button", { name: "Save draft" });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await save.click();
    await expect(page.getByRole("heading", { name: "HP-E2E-9" })).toBeVisible();
    await expect(page.locator(".uppercase").getByText("draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve bill" }).click();
    await expect(page.locator(".uppercase").getByText("approved", { exact: true })).toBeVisible();
    await page.goto("/projects/proj_okonkwo");
    await expect(page.getByRole("link", { name: /HP-E2E-9 · Harbor Plumbing · approved/ })).toBeVisible();
    const after = costDollars(await page.getByText(/cost \$/).innerText());
    expect(after).toBeCloseTo(before + 426, 2);
    await page.getByRole("link", { name: /HP-E2E-9 · Harbor Plumbing · approved/ }).click();
    await page.getByLabel("Paid on").fill("2026-10-05");
    await page.getByLabel("Payment method").selectOption("check");
    await page.getByLabel("Payment reference").fill("E2E-19");
    await page.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.locator(".uppercase").getByText("paid", { exact: true })).toBeVisible();
    await expect(page.getByText(/check · E2E-19/)).toBeVisible();
    await page.goto("/projects/proj_okonkwo");
    expect(costDollars(await page.getByText(/cost \$/).innerText())).toBeCloseTo(after, 2);
  });
});
