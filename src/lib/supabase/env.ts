export type Env = Record<string, string | undefined>;

function read(env: Env, name: string) {
  const value = env[name]?.trim();
  return value || undefined;
}

export function supabaseUrl(env: Env) {
  return read(env, "NEXT_PUBLIC_SUPABASE_URL");
}

/** Anon JWT or the newer publishable key. Never the service role. */
export function supabaseAnonKey(env: Env) {
  return read(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY") || read(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function supabaseAuthConfigured(env: Env = process.env) {
  return Boolean(supabaseUrl(env) && supabaseAnonKey(env));
}

/** Server-only. A NEXT_PUBLIC_ name is ignored on purpose. */
export function supabaseServiceRoleKey(env: Env = process.env) {
  return read(env, "SUPABASE_SERVICE_ROLE_KEY");
}
