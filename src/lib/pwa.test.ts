import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function pngSize(relative: string) {
  const buf = fs.readFileSync(path.join(root, relative));
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("installable shell", () => {
  it("ships 192 and 512 PNG icons on the manifest", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      display: string;
      start_url: string;
      icons: { src: string; sizes: string; type: string; purpose: string }[];
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    const pngs = manifest.icons.filter((icon) => icon.type === "image/png");
    expect(pngs.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    expect(pngs.every((icon) => icon.purpose === "any")).toBe(true);
    expect(pngSize("public/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(read("src/app/layout.tsx")).toContain('manifest: "/manifest.webmanifest"');
    expect(read("src/app/layout.tsx")).toContain("/apple-touch-icon.png");
  });

  it("registers a service worker that caches only the offline clock document", () => {
    const worker = read("public/sw.js");
    expect(read("src/components/register-pwa.tsx")).toContain('serviceWorker.register("/sw.js")');
    expect(worker).toContain("fieldline-shell-v2");
    expect(worker).toContain("skipWaiting");
    expect(worker).toContain("clients.claim");
    expect(worker).toContain('addEventListener("fetch"');
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain('"/api/"');
    expect(worker).toContain('"_rsc"');
    expect(worker).toContain("text/html");
    expect(worker).toContain("fieldline-offline-shell");
    expect(worker).toContain("fieldline-office-shell");
    expect(worker).toContain('"/offline"');
    expect(read("src/app/offline/page.tsx")).toContain("fieldline-offline-shell");
    expect(read("src/lib/offline/browser.ts")).not.toContain("hourly");
    expect(read("src/lib/offline/browser.ts")).not.toContain("localStorage");
  });

  it("opens the rear camera on job and estimate photos, not on text receipts", () => {
    const capture = read("src/components/photo-capture.tsx");
    expect(capture).toContain('capture="environment"');
    expect(capture).toContain('accept="image/*"');
    expect(capture).toContain("aria-label={label}");
    expect(read("src/app/(office)/projects/[id]/page.tsx")).toContain("Take a job photo");
    expect(read("src/app/(office)/estimates/[id]/page.tsx")).toContain("Take an estimate photo");
    expect(read("src/components/receipt-capture.tsx")).not.toContain("capture=");
    expect(read("src/components/offline-banner.tsx")).toContain(
      "You're offline. Clock in, breaks, job switches, clock out, and daily log notes save on this phone and sync later. Photos, approvals, and manual time stay online.",
    );
  });
});
