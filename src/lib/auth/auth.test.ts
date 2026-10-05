import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFromAuthUser } from "@/lib/auth/membership";
import { resolveLogin } from "@/lib/auth/login";
import { issueSessionValue, readSessionIds } from "@/lib/auth/session";
import { getDb, getSqlite, useDatabaseFile } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { supabaseAnonKey, supabaseAuthConfigured, supabaseServiceRoleKey } from "@/lib/supabase/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const MAYA = "11111111-1111-4111-8111-111111111111";
const JORDAN = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

beforeAll(() => {
  useDatabaseFile(":memory:");
});

afterAll(() => {
  useDatabaseFile(":memory:");
});

describe("optional supabase auth", () => {
  it("keeps the demo password and session cookie when Supabase env is empty", async () => {
    expect(supabaseAuthConfigured({})).toBe(false);
    const maya = authenticate("maya@rivera.demo", "demo");
    expect(maya?.orgId).toBe("org_rivera");
    expect(authenticate("maya@rivera.demo", "nope")).toBeNull();
    const login = await resolveLogin("maya@rivera.demo", "demo", { env: {} });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const raw = issueSessionValue(login.actor.userId, login.actor.orgId, 1_000);
    expect(readSessionIds(raw, 1_000)).toEqual({ userId: "user_maya", orgId: "org_rivera" });
    expect(readSessionIds(`${raw}x`, 1_000)).toBeNull();
    expect(readSessionIds(raw, 1_000 + 14 * 86_400_000 + 1)).toBeNull();
    const columns = getSqlite().prepare("pragma table_info(users)").all() as { name: string }[];
    expect(columns.some((column) => column.name === "auth_user_id")).toBe(true);
    const response = await updateSession(new NextRequest("http://127.0.0.1:3847/login"), {});
    expect(response.status).toBe(200);
  });

  it("links auth_user_id to the matching membership and refuses a different id", async () => {
    const linked = actorFromAuthUser(MAYA, "maya@rivera.demo");
    expect(linked).toMatchObject({ userId: "user_maya", orgId: "org_rivera", role: "owner" });
    expect(getDb().select().from(users).where(eq(users.id, "user_maya")).get()?.authUserId).toBe(MAYA);
    const again = actorFromAuthUser(MAYA);
    expect(again?.email).toBe("maya@rivera.demo");
    expect(actorFromAuthUser(OTHER, "maya@rivera.demo")).toBeNull();
    expect(getDb().select().from(users).where(eq(users.id, "user_maya")).get()?.authUserId).toBe(MAYA);

    const jordan = actorFromAuthUser(JORDAN, "Jordan@Northline.demo");
    expect(jordan).toMatchObject({ userId: "user_jordan", orgId: "org_northline" });
    expect(actorFromAuthUser("not-a-uuid", "jordan@northline.demo")).toBeNull();

    let signedOut = false;
    const rejected = await resolveLogin("maya@rivera.demo", "demo", {
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
      auth: {
        async signInWithPassword() {
          return { ok: false, error: "invalid" };
        },
        async signOut() {
          signedOut = true;
        },
      },
    });
    expect(rejected).toEqual({ ok: false, error: "That email and password were not accepted." });
    expect(signedOut).toBe(false);

    signedOut = false;
    const accepted = await resolveLogin("maya@rivera.demo", "anything", {
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
      auth: {
        async signInWithPassword() {
          return { ok: true, userId: MAYA, email: "maya@rivera.demo" };
        },
        async signOut() {
          signedOut = true;
        },
      },
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.actor.orgId).toBe("org_rivera");
    expect(signedOut).toBe(false);

    const stranger = await resolveLogin("nobody@example.com", "secret", {
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
      auth: {
        async signInWithPassword() {
          return { ok: true, userId: OTHER, email: "nobody@example.com" };
        },
        async signOut() {
          signedOut = true;
        },
      },
    });
    expect(stranger.ok).toBe(false);
    expect(signedOut).toBe(true);
  });

  it("reads the anon or publishable key and ignores a public service-role name", () => {
    expect(supabaseAnonKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk" })).toBe("pk");
    expect(supabaseAnonKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk" })).toBe("anon");
    expect(supabaseServiceRoleKey({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "service" })).toBe("service");
    expect(supabaseServiceRoleKey({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "secret" })).toBeUndefined();
    expect(() => createSupabaseServiceClient({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
