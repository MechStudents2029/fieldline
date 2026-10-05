import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseAuthConfigured, supabaseUrl, type Env } from "@/lib/supabase/env";

/** Refresh the Supabase cookies with getClaims(). Does nothing when Auth is not configured. */
export async function updateSession(request: NextRequest, env: Env = process.env) {
  if (!supabaseAuthConfigured(env)) return NextResponse.next({ request });
  const url = supabaseUrl(env);
  const key = supabaseAnonKey(env);
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  try {
    // Verifies the JWT. getSession() is not used for authorization.
    await supabase.auth.getClaims();
  } catch {
    return response;
  }
  return response;
}
