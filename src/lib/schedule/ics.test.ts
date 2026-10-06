import { describe, expect, it } from "vitest";
import { buildScheduleIcs, icsEscape } from "@/lib/schedule/ics";

describe("schedule ics", () => {
  it("escapes text and writes an all-day date span", () => {
    expect(icsEscape("Tile, set; note\nline\\")).toBe("Tile\\, set\\; note\\nline\\\\");
    const ics = buildScheduleIcs([
      {
        uid: "sch_ok_tile",
        title: "Tile, set; note\nline",
        startDate: "2026-10-06",
        endDate: "2026-10-07",
        description: "Homeowner, after 3; bring\nshims",
      },
    ]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261006");
    expect(ics).toContain("DTEND;VALUE=DATE:20261008");
    expect(ics).toContain("SUMMARY:Tile\\, set\\; note\\nline");
    expect(ics).toContain("DESCRIPTION:Homeowner\\, after 3\\; bring\\nshims");
    expect(ics.endsWith("\r\n")).toBe(true);
  });
});
