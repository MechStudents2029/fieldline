import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile } from "@/lib/db/client";
import { jobGantt, orgGantt } from "@/lib/services/gantt";
import { getPref, setPref } from "@/lib/services/prefs";
import { authenticate } from "@/lib/services/read";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("gantt model", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("groups a job by phase, marks the gate, and computes float", () => {
    const model = jobGantt(actor("maya@rivera.demo"), "proj_brooks", "week");
    expect(model?.canEdit).toBe(true);
    expect(model?.groups.map((group) => group.title).sort()).toEqual(["Close-in", "Framing"]);
    const bars = model?.groups.flatMap((group) => group.bars) ?? [];
    const drywall = bars.find((bar) => bar.title === "Drywall");
    expect(drywall?.held).toBeTruthy();
    expect(bars.some((bar) => bar.critical)).toBe(true);
    expect(bars.some((bar) => bar.float > 0)).toBe(true);
    expect(model?.days.some((day) => day.off)).toBe(true);
    expect(model?.links.length).toBeGreaterThan(0);
  });

  it("lists jobs as rollup rows and keeps field read-only", () => {
    const org = orgGantt(actor("maya@rivera.demo"), "month");
    expect(org.groups.some((group) => group.title.includes("Brooks"))).toBe(true);
    expect(org.zoom).toBe("month");
    const field = jobGantt(actor("dana@rivera.demo"), "proj_brooks");
    expect(field?.canEdit).toBe(false);
  });

  it("remembers a view for that user", () => {
    const maya = actor("maya@rivera.demo");
    expect(getPref(maya, "scheduleView")).toBeNull();
    setPref(maya, "scheduleView", "gantt");
    expect(getPref(maya, "scheduleView")).toBe("gantt");
    setPref(maya, "scheduleView", "nope");
    expect(getPref(maya, "scheduleView")).toBe("gantt");
  });
});
