import { describe, expect, it } from "vitest";
import { checklistFraction, deadlinePhrase, linkedDeadline, reminderDay } from "@/lib/todos/deadline";

describe("to-do deadlines", () => {
  it("counts workdays before and after an edge", () => {
    expect(linkedDeadline("2026-10-09", -1)).toBe("2026-10-08");
    expect(linkedDeadline("2026-10-05", 2)).toBe("2026-10-07");
    expect(linkedDeadline("2026-10-05", 0)).toBe("2026-10-05");
    expect(linkedDeadline("2026-10-10", 0)).toBe("2026-10-12");
    expect(deadlinePhrase("finish", -1)).toBe("1 workday before finish");
    expect(deadlinePhrase("start", 2)).toBe("2 workdays after start");
  });

  it("places a reminder a calendar span before the deadline", () => {
    expect(reminderDay("2026-10-09", 1)).toBe("2026-10-08");
    expect(reminderDay("2026-10-12", 3)).toBe("2026-10-09");
    expect(checklistFraction(3, 7)).toBe("3/7");
  });
});
