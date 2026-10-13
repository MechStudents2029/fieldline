import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bookings, invoices, leads, messages, projects } from "@/lib/db/schema";
import { assignDispatch, dispatchBoard } from "@/lib/services/dispatch";
import { listInbox, openNotification } from "@/lib/services/comments";
import { parseTrigger, triggerLabel } from "@/lib/services/automations";
import { authenticate } from "@/lib/services/read";
import { todayKey } from "@/lib/receiving/facts";
import { bookPublic, bookingAttention, bookingBoard, publicBooking, saveBookingPrefs } from "@/lib/services/booking";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("online booking", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("offers Service call, assigns the first free tech, and refuses a taken slot", () => {
    const maya = actor("maya@rivera.demo");
    const page = publicBooking("demo_booking_rivera", {});
    expect(page?.state).toBe("open");
    expect(page?.services).toEqual([expect.objectContaining({ id: "pb_svc_call", name: "Service call", duration: "1h", price: "$189" })]);
    expect(page?.questions).toEqual([{ id: "q1", label: "Gate code" }]);
    expect(publicBooking("missing", {})).toBeNull();
    expect(bookingBoard(actor("dana@rivera.demo"))).toBeNull();
    expect(() =>
      saveBookingPrefs(actor("dana@rivera.demo"), {
        enabled: false,
        earliestHours: 24,
        intervalMin: 30,
        bufferMin: 0,
        start: "08:00",
        end: "17:00",
        days: [1, 2, 3, 4, 5],
        questions: "",
      }),
    ).toThrow(/owner or admin/);

    const offered = publicBooking("demo_booking_rivera", { service: "pb_svc_call" });
    const day = offered?.days[0];
    const slot = day?.slots[0];
    if (!day || !slot) throw new Error("no bookable slot");
    const today = todayKey(getDb(), maya.orgId);
    expect(day.day > today || slot.startMin >= 15 * 60).toBe(true);

    const before = {
      invoices: getDb().select().from(invoices).all().length,
      leads: getDb().select().from(leads).all().length,
      projects: getDb().select().from(projects).all().length,
      messages: getDb().select().from(messages).all().length,
    };
    const placed = bookPublic({
      token: "demo_booking_rivera",
      itemId: "pb_svc_call",
      day: day.day,
      startMin: slot.startMin,
      name: "Ava Moss",
      phone: "(510) 555-0198",
      email: "ava.moss.book@example.com",
      answers: { q1: "2214" },
    });
    expect(placed.assigneeName).toBe("Dana Cho");
    expect(placed.day).toBe(day.day);
    const row = getDb().select().from(bookings).where(eq(bookings.id, placed.bookingId)).get();
    expect(row).toMatchObject({ assigneeUserId: "user_dana", status: "scheduled", priceCents: 18900, orgId: "org_rivera" });
    expect(() =>
      bookPublic({
        token: "demo_booking_rivera",
        itemId: "pb_svc_call",
        day: day.day,
        startMin: slot.startMin,
        name: "Bea Moss",
        phone: "(510) 555-0197",
        email: "bea.moss.book@example.com",
        answers: {},
      }),
    ).toThrow(/taken/);

    const board = dispatchBoard(maya, day.day);
    const card = board.cards.find((item) => item.id === `book:${placed.bookingId}`);
    expect(card).toMatchObject({ title: "Service call", site: "Ava Moss", assigneeId: "user_dana", kind: "book" });
    expect(getDb().select().from(invoices).all().length).toBe(before.invoices);
    expect(getDb().select().from(leads).all().length).toBe(before.leads);
    expect(getDb().select().from(projects).all().length).toBe(before.projects);
    expect(getDb().select().from(messages).all().length).toBe(before.messages);
    expect(bookingAttention("org_rivera").count).toBeGreaterThanOrEqual(2);

    const inbox = listInbox(maya, "unread");
    const note = inbox.find((item) => item.snippet.includes("Service call") && item.who === "Ava Moss");
    expect(note?.record).toBe("Ava Moss");
    expect(openNotification(maya, note?.id || "")).toBe(`/dispatch?on=${day.day}`);
    expect(getDb().select().from(auditLogs).where(eq(auditLogs.action, "booking.create")).all().length).toBeGreaterThan(0);
    expect(triggerLabel(parseTrigger(JSON.stringify({ kind: "booking_created" }))!)).toBe("Online booking created");
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["bookings", "booking_hours", "booking_offs"]) expect(sql).toContain(`'${table}'`);
  });

  it("keeps the seeded visit on the open list and uses the same overlap rule", () => {
    const maya = actor("maya@rivera.demo");
    const day = todayKey(getDb(), maya.orgId);
    const board = dispatchBoard(maya, day);
    const seeded = board.cards.find((card) => card.id === "book:book_ellis");
    expect(seeded).toMatchObject({ title: "Service call", site: "Nora Ellis", assigneeId: null, start: "16:00" });
    expect(board.open).toBeGreaterThan(board.cards.filter((card) => !card.closed && !card.assigneeId).length);
    expect(() => assignDispatch(maya, { cardId: "book:book_ellis", assigneeId: "user_dana", start: "07:30", end: "08:30", day })).toThrow(/Overlaps Tile shower/);
    assignDispatch(maya, { cardId: "book:book_ellis", assigneeId: "user_dana", start: "16:00", end: "17:00", day });
    expect(getDb().select().from(bookings).where(eq(bookings.id, "book_ellis")).get()?.assigneeUserId).toBe("user_dana");
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, "book_ellis")).all();
    expect(audit.map((row) => row.action)).toContain("dispatch.assign");
    expect(audit.every((row) => row.entityType === "booking")).toBe(true);
  });
});
