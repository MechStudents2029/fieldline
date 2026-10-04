const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identity for office RLS. Service-role and anon tokens are not a member session. */
export function authUserIdFromClaims(claims: Record<string, unknown> | null | undefined): string | null {
  if (!claims) return null;
  if (claims.role === "service_role" || claims.role === "anon") return null;
  const sub = claims.sub;
  if (typeof sub !== "string" || !AUTH_USER_ID.test(sub)) return null;
  return sub;
}
