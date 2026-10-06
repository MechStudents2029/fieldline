import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("iOS shell", () => {
  it("defines the Deep Teal tokens, type scale, and system color scheme", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("--fl-accent: #0a7a6f");
    expect(css).toContain("--fl-bg: #f2f2f7");
    expect(css).toContain("--fl-label: #1c1c1e");
    expect(css).toContain("--fl-secondary: #6e6e73");
    expect(css).not.toContain("--fl-system-blue");
    expect(css).toContain("--fl-warning: #a35c00");
    expect(css).toContain("--fl-danger: #c8372d");
    expect(css).toContain("--fl-radius: 12px");
    expect(css).toContain("--fl-touch: 44px");
    expect(css).toContain("SF Pro Text");
    expect(css).toContain("font-size: 34px");
    expect(css).toContain("font-size: 17px");
    expect(css).toContain("font-size: 13px");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--fl-bg: #000000");
    expect(css).toContain("--fl-elevated: #1c1c1e");
    expect(css).toContain("--fl-elevated-2: #2c2c2e");
    expect(css).toContain("--fl-accent: #2bb5a6");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("scale(0.97)");
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('viewportFit: "cover"');
    expect(layout).not.toContain("next/font/google");
  });

  it("keeps the office mark and gives field users a shorter tab bar", () => {
    const shell = read("src/components/shell.tsx");
    expect(shell).toContain('id="fieldline-office-shell"');
    expect(shell).toContain('aria-label="Primary"');
    expect(shell).toContain('aria-label="Office"');
    const office = shell.slice(shell.indexOf("const officeTabs"), shell.indexOf("const fieldTabs"));
    const field = shell.slice(shell.indexOf("const fieldTabs"), shell.indexOf("const fieldHidden"));
    for (const label of ["Today", "Jobs", "Leads", "Time", "More"]) {
      expect(office).toContain(`label: "${label}"`);
    }
    expect(field).toContain('label: "My day"');
    expect(field).toContain('label: "Jobs"');
    expect(field).toContain('label: "Time"');
    expect(field).toContain('label: "More"');
    expect(field).not.toContain("Leads");
    expect(read("src/app/(office)/more/page.tsx")).toContain('["/pipeline", "Pipeline"]');
  });
});
