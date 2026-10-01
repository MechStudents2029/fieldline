import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromIds, type Actor } from "@/lib/services/read";

const COOKIE = "fieldline_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }
  return "dev-only-fieldline-session";
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export async function setSession(actor: Actor) {
  const body = Buffer.from(
    JSON.stringify({ userId: actor.userId, orgId: actor.orgId, exp: Date.now() + 14 * 86_400_000 }),
  ).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${body}.${sign(body)}`, {
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
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      userId: string;
      orgId: string;
      exp: number;
    };
    if (!payload.exp || payload.exp < Date.now()) return null;
    return actorFromIds(payload.userId, payload.orgId);
  } catch {
    return null;
  }
}
