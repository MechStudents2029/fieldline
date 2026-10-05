"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

/** Browser client for the anon or publishable key. Do not pass the service role. */
export function createBrowserSupabase() {
  const url = supabaseUrl(process.env);
  const key = supabaseAnonKey(process.env);
  if (!url || !key) throw new Error("Supabase Auth is not configured.");
  return createBrowserClient(url, key);
}
