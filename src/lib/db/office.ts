import { eq } from "drizzle-orm";
import { getDb, getHolder, getRlsDb, type AppDatabase } from "@/lib/db/client";
import { memberships, users } from "@/lib/db/schema";
import { officeClaim } from "@/lib/db/rls-context";
import { supabaseAuthConfigured } from "@/lib/supabase/env";

const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same predicate as public.current_org_ids() in supabase/rls.sql.
 * The lookup uses the owner connection on purpose: that function is security definer.
 */
export function currentOrgIds(authUserId: string): string[] {
  if (!AUTH_USER_ID.test(authUserId)) return [];
  return getDb()
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(users.authUserId, authUserId))
    .all()
    .map((row) => row.orgId);
}

export function resolveReadConnection(input: {
  purpose: "office" | "privileged";
  supabaseConfigured: boolean;
  authUserId: string | null;
  dialect: "sqlite" | "postgres";
}): "owner" | "rls" {
  if (input.purpose === "privileged") return "owner";
  if (!input.supabaseConfigured || !input.authUserId) return "owner";
  if (input.dialect !== "postgres") return "owner";
  return "rls";
}

/**
 * Office tenant connection for reads and writes. Demo mode (no Supabase auth, or no verified claim) keeps getDb().
 * A verified claim that does not belong to orgId returns null so the caller shows nothing or refuses the write.
 * On Postgres the statements run as role `authenticated`, not as the table owner, so RLS USING and WITH CHECK apply.
 */
export function officeDb(orgId: string): AppDatabase | null {
  const claim = officeClaim();
  if (!claim || !supabaseAuthConfigured()) return getDb();
  if (!currentOrgIds(claim.authUserId).includes(orgId)) return null;
  if (getHolder().dialect === "postgres") return getRlsDb();
  return getDb();
}
