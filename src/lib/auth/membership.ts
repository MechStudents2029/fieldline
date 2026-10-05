import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { memberships, users } from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";
import { actorFromIds, type Actor } from "@/lib/services/read";

const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the Fieldline membership for a Supabase Auth user.
 * The first sign-in for a seeded email stores auth_user_id on the owner connection.
 * There is no member JWT yet, so that write cannot use the authenticated role.
 * A later sign-in must present that same id.
 */
export function actorFromAuthUser(authUserId: string, email?: string | null): Actor | null {
  if (!AUTH_USER_ID.test(authUserId)) return null;
  const db = getDb();
  const linked = db.select().from(users).where(eq(users.authUserId, authUserId)).get();
  if (linked) return actorForUser(linked.id);
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  const byEmail = db.select().from(users).where(eq(users.email, normalized)).get();
  if (!byEmail || byEmail.authUserId) return null;
  db.update(users)
    .set({ authUserId, updatedAt: nowIso() })
    .where(and(eq(users.id, byEmail.id), isNull(users.authUserId)))
    .run();
  const fresh = db.select().from(users).where(eq(users.id, byEmail.id)).get();
  if (fresh?.authUserId !== authUserId) return null;
  return actorForUser(fresh.id);
}

function actorForUser(userId: string): Actor | null {
  const membership = getDb().select().from(memberships).where(eq(memberships.userId, userId)).get();
  if (!membership) return null;
  return actorFromIds(userId, membership.orgId);
}
