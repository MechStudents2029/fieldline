import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useDatabaseFile, getDb } from "@/lib/db/client";
import { scheduleItems } from "@/lib/db/schema";
import { addCalendarDays } from "@/lib/time/calendar";
import { cashForecast } from "@/lib/services/cash";
import { ServiceError } from "@/lib/services/errors";
import { authenticate } from "@/lib/services/read";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("cash forecast access", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("builds 13 weeks for office and refuses field and viewer", () => {
    const board = cashForecast(actor("maya@rivera.demo"), { projected: false, jobId: "", customerId: "" });
    expect(board.forecast.columns[0]?.label).toBe("Past due");
    expect(board.forecast.columns).toHaveLength(14);
    expect(board.forecast.rows.some((row) => row.id === "balance")).toBe(true);
    expect(() => cashForecast(actor("dana@rivera.demo"), { projected: false, jobId: "", customerId: "" })).toThrow(ServiceError);
    expect(() => cashForecast(actor("riley@rivera.demo"), { projected: false, jobId: "", customerId: "" })).toThrow(ServiceError);
  });

  it("moves a draw when the linked schedule item moves", () => {
    const maya = actor("maya@rivera.demo");
    const before = cashForecast(maya, { projected: false, jobId: "proj_okonkwo", customerId: "" });
    const line = before.lines.find((row) => row.id === "drw_ok_tile");
    expect(line?.group).toBe("draw");
    const item = getDb().select().from(scheduleItems).where(eq(scheduleItems.id, "sch_ok_demo")).get();
    expect(item).toBeTruthy();
    const nextEnd = addCalendarDays(item!.endDate, 7);
    getDb().update(scheduleItems).set({ endDate: nextEnd }).where(eq(scheduleItems.id, item!.id)).run();
    const after = cashForecast(maya, { projected: false, jobId: "proj_okonkwo", customerId: "" });
    expect(after.lines.find((row) => row.id === "drw_ok_tile")?.date).toBe(addCalendarDays(line!.date, 7));
  });
});
