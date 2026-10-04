import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { enterOfficeClaim } from "@/lib/db/rls-context";
import { readSessionPayload } from "@/lib/security";
import { actorFromIds, type Actor } from "@/lib/services/read";
import { authUserIdFromClaims } from "@/lib/supabase/claims";
import { supabaseAuthConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const COOKIE = "fieldline_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  // Vercel always sets NODE_ENV=production. The demo still has to sign in with no keys.
  // This value is in the source, so set SESSION_SECRET before treating the URL as private.
  if (process.env.VERCEL) return "fieldline-public-demo-session";
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }
  return "dev-only-fieldline-session";
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function issueSessionValue(userId: string, orgId: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ userId, orgId, exp: now + 14 * 86_400_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionIds(raw: string, now = Date.now()): { userId: string; orgId: string } | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = readSessionPayload(JSON.parse(Buffer.from(body, "base64url").toString()));
    if (!payload || payload.exp < now) return null;
    return { userId: payload.userId, orgId: payload.orgId };
  } catch {
    return null;
  }
}

export async function setSession(actor: Actor) {
  const jar = await cookies();
  jar.set(COOKIE, issueSessionValue(actor.userId, actor.orgId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 14 * 86_400,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function requireSession(): Promise<Actor> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function getSession(): Promise<Actor | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const ids = readSessionIds(raw);
  if (!ids) return null;
  if (supabaseAuthConfigured()) {
    const authUserId = await verifiedOfficeUser();
    if (!authUserId) return null;
    // Visible to office reads later in this request. getClaims() verified the JWT.
    enterOfficeClaim(authUserId);
  }
  return actorFromIds(ids.userId, ids.orgId);
}

async function verifiedOfficeUser(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    return authUserIdFromClaims(data?.claims as Record<string, unknown> | undefined);
  } catch {
    return null;
  }
}
