import { describe, expect, it } from "vitest";
import { addClock, assertDuration, daySlots, pickAssignee } from "@/lib/booking/slots";

const dana = { id: "user_dana", hours: "inherit" as const };
const luis = { id: "user_luis", hours: "inherit" as const };

function slots(extra?: Partial<Parameters<typeof daySlots>[0]>) {
  return daySlots({
    durationMin: 60,
    intervalMin: 30,
    bufferMin: 0,
    company: { startMin: 8 * 60, endMin: 16 * 60 },
    techs: [dana],
    busy: [],
    off: [],
    notBeforeMin: 0,
    ...extra,
  });
}

describe("booking slots", () => {
  it("keeps a slot only when a tech is free for the whole duration", () => {
    const open = slots({ busy: [{ userId: "user_dana", startMin: 7 * 60 + 30, endMin: 8 * 60 + 30 }] });
    expect(open[0]).toMatchObject({ startMin: 8 * 60 + 30, endMin: 9 * 60 + 30, userIds: ["user_dana"] });
    expect(open.some((slot) => slot.startMin === 8 * 60)).toBe(false);
    expect(assertDuration(15)).toBe(15);
    expect(() => assertDuration(10)).toThrow(/15 minutes/);
    expect(() => assertDuration(13 * 60)).toThrow(/12 hours/);
  });

  it("applies buffer, time off, and a per-tech window", () => {
    const buffered = slots({
      bufferMin: 30,
      busy: [{ userId: "user_dana", startMin: 9 * 60, endMin: 10 * 60 }],
    });
    expect(buffered.some((slot) => slot.startMin === 8 * 60)).toBe(false);
    expect(buffered.some((slot) => slot.startMin === 10 * 60 + 30)).toBe(true);
    expect(slots({ off: ["user_dana"] })).toEqual([]);
    const early = slots({ techs: [{ id: "user_dana", hours: { startMin: 7 * 60, endMin: 9 * 60 } }] });
    expect(early.map((slot) => slot.startMin)).toEqual([7 * 60, 7 * 60 + 30, 8 * 60]);
    expect(slots({ company: null })).toEqual([]);
  });

  it("picks the first free id and refuses a slot nobody can take", () => {
    const both = slots({ techs: [luis, dana] });
    expect(both[0]?.userIds).toEqual(["user_dana", "user_luis"]);
    expect(pickAssignee(both[0]!.userIds)).toBe("user_dana");
    expect(() => pickAssignee([])).toThrow(/free/);
    const later = addClock("2026-10-13", 15 * 60, 2 * 60);
    expect(later).toEqual({ day: "2026-10-13", minute: 17 * 60 });
    expect(addClock("2026-10-13", 23 * 60, 90)).toEqual({ day: "2026-10-14", minute: 30 });
    const cutoff = slots({ notBeforeMin: 15 * 60 });
    expect(cutoff[0]?.startMin).toBe(15 * 60);
  });
});
