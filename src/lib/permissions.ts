export const ROLES = ["owner", "admin", "estimator", "field", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function canSeeMoney(role: Role): boolean {
  return role !== "field";
}

export function canEditCrm(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "estimator";
}

export function canManageMoney(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "estimator";
}

export function canAddFieldNotes(role: Role): boolean {
  return role !== "viewer";
}

export function canManageSettings(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Office is the estimator seat: prices and drafts, not company settings. */
export const INVITE_ROLES = ["admin", "estimator", "field"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export function isInviteRole(value: string): value is InviteRole {
  return (INVITE_ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: string): string {
  if (role === "estimator") return "Office";
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "field") return "Field";
  if (role === "viewer") return "Viewer";
  return role;
}

/** Owners grant owner and admin. Admins grant office, field, and viewer. */
export function canGrantRole(actorRole: Role, targetRole: Role): boolean {
  if (!canManageSettings(actorRole)) return false;
  if ((targetRole === "owner" || targetRole === "admin") && actorRole !== "owner") return false;
  return true;
}
