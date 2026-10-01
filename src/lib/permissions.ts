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
