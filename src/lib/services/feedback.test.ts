import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { users } from "@/lib/db/schema";
import { authenticate, listTesterFeedback } from "@/lib/services/read";
import { submitTesterFeedback } from "@/lib/services/write";

const MAYA = "11111111-1111-4111-8111-111111111111";
const JORDAN = "22222222-2222-4222-8222-222222222222";

describe("tester feedback", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
    getDb().update(users).set({ authUserId: MAYA }).where(eq(users.id, "user_maya")).run();
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    useDatabaseFile(":memory:");
  });

  it("stores a note for the signed-in company and hides it from the other", () => {
    const maya = authenticate("maya@rivera.demo", "demo");
    const jordan = authenticate("jordan@northline.demo", "demo");
    expect(maya && jordan).toBeTruthy();
    submitTesterFeedback(maya!, {
      path: "/projects/proj_okonkwo",
      body: "The deposit button label was easy to miss.",
      context: "Desktop Chrome, expected a larger Pay button",
    });
    expect(listTesterFeedback("org_rivera").some((note) => note.body.includes("deposit button"))).toBe(true);
    expect(listTesterFeedback("org_northline").some((note) => note.body.includes("deposit button"))).toBe(false);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    expect(withOfficeClaim(JORDAN, () => listTesterFeedback("org_rivera"))).toEqual([]);
    expect(() =>
      withOfficeClaim(JORDAN, () =>
        submitTesterFeedback(maya!, { path: "/pipeline", body: "Should not land on Rivera." }),
      ),
    ).toThrow(/signed-in account/);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("rejects an empty note and a pasted screenshot", () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    expect(() => submitTesterFeedback(maya, { path: "/", body: "   " })).toThrow(/short note/);
    expect(() => submitTesterFeedback(maya, { path: "/", body: "see data:image/png;base64,aaaa" })).toThrow(/screenshots/);
  });
});
