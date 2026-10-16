import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, revealToday } from "./helpers";

function shot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
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

test("request a signature, sign from the link, and decline another", async ({ page, request }) => {
  await resetDemo(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(page, "maya@rivera.demo");
  await revealToday(page, "Sign due");
  await expect(page.locator("a:visible", { hasText: "Sign due" })).toContainText("1");

  await page.goto("/signatures/new");
  await page.getByLabel("Title", { exact: true }).fill("Vendor packet");
  await page.getByLabel("Signer", { exact: true }).selectOption({ label: "Harbor Plumbing" });
  await page.getByLabel("Document", { exact: true }).setInputFiles({
    name: "packet.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await page.getByRole("button", { name: "Request" }).click();
  await expect(page.getByRole("heading", { name: "Vendor packet" })).toBeVisible();
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.locator("[data-status='out']")).toBeVisible();
  const link = await page.getByLabel("Sign link").inputValue();
  expect(link).toContain("/sign/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /Rivera/ })).toBeVisible();
  await expect(page.getByText("Vendor packet")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Avery Cole");
  const canvas = page.getByLabel("Draw your signature");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("signature pad");
  await page.mouse.move(box.x + 24, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 70);
  await page.mouse.up();
  await page.waitForTimeout(3200);
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(page.locator("[data-status='signed']")).toBeVisible();
  await expect(page.getByText("Avery Cole")).toBeVisible();
  await expect(page.locator("[data-hash]")).toHaveAttribute("data-hash", /^[a-f0-9]{64}$/);
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "signatures-certificate-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "signatures-certificate-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/sign/demo_sign_co_d1");
  await expect(page.getByText("Change order")).toBeVisible();
  await page.waitForTimeout(3200);
  await page.getByLabel("Reason", { exact: true }).fill("Not our scope");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.locator("[data-status='declined']")).toBeVisible();

  await signInAs(page, "maya@rivera.demo");
  await page.goto("/signatures");
  await expect(page.getByRole("table", { name: "Signatures" }).getByRole("link", { name: "Vendor packet" })).toBeVisible();
  await expect(page.locator("[data-request='dsr_co']")).toHaveAttribute("data-status", "declined");
  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/signatures?status=&project=&signer=&overdue=");
    return { status: response.status, body: await response.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.body).toContain("Vendor packet");
  expect(csv.body).toContain("Subcontract");

  await signInAs(page, "dana@rivera.demo");
  await page.goto("/signatures");
  await expect(page.getByRole("link", { name: "Vendor packet" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Change order" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Subcontract" })).toHaveCount(0);
});
