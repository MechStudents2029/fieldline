export type Env = Record<string, string | undefined>;

function read(env: Env, name: string) {
  const value = env[name]?.trim();
  return value || undefined;
}

export function supabaseUrl(env: Env) {
  return read(env, "NEXT_PUBLIC_SUPABASE_URL");
}

function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString()) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Anon JWT or the newer publishable key. A service-role JWT in a public variable is refused. */
export function supabaseAnonKey(env: Env) {
  const key = read(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY") || read(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!key || jwtRole(key) === "service_role") return undefined;
  return key;
}

export function supabaseAuthConfigured(env: Env = process.env) {
  return Boolean(supabaseUrl(env) && supabaseAnonKey(env));
}

/** Server-only. A NEXT_PUBLIC_ name is ignored on purpose. */
export function supabaseServiceRoleKey(env: Env = process.env) {
  return read(env, "SUPABASE_SERVICE_ROLE_KEY");
}
