import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("simple copy", () => {
  it("has no reassurance disclaimers", () => {
    const hits: string[] = [];
    for (const file of files(path.join(root, "src"))) {
      const text = fs.readFileSync(file, "utf8");
      if (/Nothing (is|was|sends)/.test(text)) hits.push(path.relative(root, file));
    }
    expect(hits).toEqual([]);
  });

  it("rejects sentence-length row subtitles", () => {
    const hits: string[] = [];
    for (const file of files(path.join(root, "src"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/subtitle="([^"]+)"/g)) {
        const value = match[1];
        const words = value.trim().split(/\s+/).filter(Boolean);
        if (value.includes(". ") || words.length > 6) hits.push(`${path.relative(root, file)}: ${value}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
