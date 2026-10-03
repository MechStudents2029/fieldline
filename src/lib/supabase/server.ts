import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

export async function createSupabaseServerClient() {
  const url = supabaseUrl(process.env);
  const key = supabaseAnonKey(process.env);
  if (!url || !key) throw new Error("Supabase Auth is not configured.");
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) jar.set(name, value, options);
        } catch {
          // A Server Component cannot always write cookies. src/proxy.ts refreshes them.
        }
      },
    },
  });
}
