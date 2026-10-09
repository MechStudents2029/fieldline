import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { columnFit } from "@/components/mac/data-table";

function files(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      found.push(...files(full));
    } else if (name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

describe("compact controls", () => {
  it("marks date, amount, and status columns for the nowrap guard", () => {
    expect(columnFit({ key: "start", header: "Start", fit: true })).toBe("date");
    expect(columnFit({ key: "contract", header: "Contract", align: "right" })).toBe("amount");
    expect(columnFit({ key: "cost", header: "Cost to date", align: "right" })).toBe("amount");
    expect(columnFit({ key: "status", header: "Status" })).toBe("status");
    expect(columnFit({ key: "job", header: "Job" })).toBeUndefined();
  });

  it("keeps raw file inputs inside the shared picker or the camera control", () => {
    const allowed = new Set(["file-button.tsx", "photo-capture.tsx"]);
    const offenders = files(path.join(process.cwd(), "src"))
      .filter((file) => /type=["']file["']/.test(readFileSync(file, "utf8")))
      .map((file) => path.basename(file))
      .filter((name) => !allowed.has(name));
    expect(offenders).toEqual([]);
  });
});
