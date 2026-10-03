import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Service-role client for portal, pay, cron, and webhook work that cannot
 * run as a signed-in member. Office pages do not use this. The key is never
 * read from a NEXT_PUBLIC_ variable.
 */
export function createSupabaseServiceClient(env: Record<string, string | undefined> = process.env) {
  const url = supabaseUrl(env);
  const key = supabaseServiceRoleKey(env);
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this path.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
