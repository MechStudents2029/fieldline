import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const officePickers = [
  "src/components/todo-pane.tsx",
  "src/components/my-day.tsx",
  "src/components/rfi-create-form.tsx",
  "src/app/(office)/projects/[id]/rfis/[rfiId]/page.tsx",
  "src/components/punch-section.tsx",
  "src/app/(office)/contacts/[id]/page.tsx",
  "src/app/(office)/projects/[id]/bids/page.tsx",
  "src/components/bill-composer.tsx",
];

describe("office file pickers", () => {
  it("uses FileButton instead of a raw file input", () => {
    for (const file of officePickers) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("FileButton");
      expect(source, file).not.toContain('type="file"');
    }
    const button = readFileSync("src/components/file-button.tsx", "utf8");
    expect(button).toContain("file-pick-input");
    expect(button).toContain("file-pick-btn");
  });
});
