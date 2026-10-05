import { and, desc, eq } from "drizzle-orm";
import { hashPassword, newSalt } from "@/lib/auth/password";
import { hashInviteToken, inviteTokenShape, newInviteToken } from "@/lib/auth/invite-token";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { activities, memberships, organizations, teamInvites, users } from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canGrantRole, canManageSettings, isInviteRole, isRole, roleLabel, type InviteRole, type Role } from "@/lib/permissions";
import { acceptAllowed, appOrigin, normalizeEmail, passwordError } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import { actorFromIds, type Actor } from "@/lib/services/read";

export const INVITE_INVALID = "This invite link is not valid.";
export const INVITE_EMAIL = "Sign in with the invited email to accept this invite.";
export const ACCEPT_LIMIT = "Too many invite attempts from this network. Wait a few minutes and try again.";

const ADMIN_TTL_MS = 48 * 60 * 60 * 1000;
const MEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Writer = Pick<AppDatabase, "insert" | "select" | "update">;

export type InvitePreview = {
  companyName: string;
  role: InviteRole;
  roleLabel: string;
  inviterName: string;
  email: string;
  expiresAt: string;
  accountExists: boolean;
};

export function inviteTtlMs(role: InviteRole): number {
  return role === "admin" ? ADMIN_TTL_MS : MEMBER_TTL_MS;
}

export function invitePasteMessage(input: { companyName: string; roleLabel: string; url: string; expiresAt: string }) {
  return `Join ${input.companyName} on Fieldline as ${input.roleLabel}. Open ${input.url} (expires ${input.expiresAt.slice(0, 10)}). Nothing was emailed.`;
}

export function createInvite(actor: Actor, input: { email: string; role: string }, now = Date.now()) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can invite a teammate.");
  if (!isInviteRole(input.role)) throw new ServiceError("Pick a role.");
  if (!canGrantRole(actor.role, input.role)) throw new ServiceError("Only an owner can invite an admin.");
  const email = normalizeEmail(input.email);
  if (!email) throw new ServiceError("Enter a valid email.");
  const origin = appOrigin(process.env);
  if (!origin) throw new ServiceError("Set APP_URL before sharing invite links.");
  const db = officeOrThrow(actor);
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("Company not found.");
  const existingUser = db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    const member = db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, existingUser.id)))
      .get();
    if (member) throw new ServiceError("That person is already on this company.");
  }
  const token = newInviteToken();
  const expiresAt = new Date(now + inviteTtlMs(input.role)).toISOString();
  const inviteId = id("inv");
  db.transaction((tx) => {
    revokePending(tx, actor.orgId, email, actor.userId, new Date(now).toISOString());
    tx.insert(teamInvites)
      .values({
        id: inviteId,
        orgId: actor.orgId,
        email,
        role: input.role,
        tokenHash: hashInviteToken(token),
        status: "pending",
        invitedBy: actor.userId,
        expiresAt,
        acceptedBy: null,
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date(now).toISOString(),
      })
      .run();
    trail(tx, actor.orgId, inviteId, "invited", `Invited ${email} as ${roleLabel(input.role)}.`, actor.userId, new Date(now).toISOString());
  });
  const url = `${origin}/invite/${token}`;
  return {
    url,
    message: invitePasteMessage({ companyName: org.name, roleLabel: roleLabel(input.role), url, expiresAt }),
    expiresAt,
    email,
    role: input.role,
  };
}

export function revokeInvite(actor: Actor, inviteId: string) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can revoke an invite.");
  const db = officeOrThrow(actor);
  const invite = db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.orgId, actor.orgId)))
    .get();
  if (!invite || invite.status !== "pending") throw new ServiceError("That invite is not pending.");
  const now = nowIso();
  db.update(teamInvites)
    .set({ status: "revoked", revokedAt: now })
    .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.orgId, actor.orgId), eq(teamInvites.status, "pending")))
    .run();
  trail(db, actor.orgId, inviteId, "revoked", `Revoked the invite for ${invite.email}.`, actor.userId, now);
}

export function changeMemberRole(actor: Actor, userId: string, role: string) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can change roles.");
  if (!isRole(role)) throw new ServiceError("Pick a role.");
  if (!canGrantRole(actor.role, role)) throw new ServiceError("Only an owner can grant owner or admin.");
  const db = officeOrThrow(actor);
  const target = membershipOf(db, actor.orgId, userId);
  if (!target) throw new ServiceError("That person is not on this company.");
  if (actor.role === "admin" && (target.role === "owner" || target.role === "admin")) {
    throw new ServiceError("Only an owner can change an owner or admin.");
  }
  assertKeepsOwner(db, actor.orgId, target.role, role);
  if (target.role === role) return;
  const now = nowIso();
  db.update(memberships)
    .set({ role })
    .where(and(eq(memberships.id, target.id), eq(memberships.orgId, actor.orgId)))
    .run();
  const person = db.select().from(users).where(eq(users.id, userId)).get();
  trail(
    db,
    actor.orgId,
    target.id,
    "role_changed",
    `Changed ${person?.name || "a teammate"} from ${roleLabel(target.role)} to ${roleLabel(role)}.`,
    actor.userId,
    now,
  );
}

export function removeMember(actor: Actor, userId: string) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can remove a teammate.");
  const db = officeOrThrow(actor);
  const target = membershipOf(db, actor.orgId, userId);
  if (!target) throw new ServiceError("That person is not on this company.");
  if (actor.role === "admin" && (target.role === "owner" || target.role === "admin")) {
    throw new ServiceError("Only an owner can remove an owner or admin.");
  }
  assertKeepsOwner(db, actor.orgId, target.role, null);
  const person = db.select().from(users).where(eq(users.id, userId)).get();
  const now = nowIso();
  db.delete(memberships).where(and(eq(memberships.id, target.id), eq(memberships.orgId, actor.orgId))).run();
  trail(db, actor.orgId, target.id, "removed", `Removed ${person?.name || person?.email || "a teammate"} from the company.`, actor.userId, now);
}

export function teamBoard(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const members = db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      membershipId: memberships.id,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
  const now = Date.now();
  const pending = db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.orgId, orgId), eq(teamInvites.status, "pending")))
    .all()
    .filter((invite) => Date.parse(invite.expiresAt) > now);
  const activity = db
    .select()
    .from(activities)
    .where(and(eq(activities.orgId, orgId), eq(activities.entityType, "membership")))
    .orderBy(desc(activities.createdAt))
    .limit(12)
    .all();
  return { members, pending, activity };
}

export function previewInvite(token: string, options?: { ip?: string; now?: number }): { ok: true; preview: InvitePreview } | { ok: false; error: string } {
  const now = options?.now ?? Date.now();
  if (options?.ip && !acceptAllowed(options.ip, now)) return { ok: false, error: ACCEPT_LIMIT };
  const row = loadPending(token, now);
  if (!row) return { ok: false, error: INVITE_INVALID };
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, row.orgId)).get();
  const inviter = db.select().from(users).where(eq(users.id, row.invitedBy)).get();
  const account = db.select({ id: users.id }).from(users).where(eq(users.email, row.email)).get();
  if (!org || !isInviteRole(row.role)) return { ok: false, error: INVITE_INVALID };
  return {
    ok: true,
    preview: {
      companyName: org.name,
      role: row.role,
      roleLabel: roleLabel(row.role),
      inviterName: inviter?.name || "A teammate",
      email: row.email,
      expiresAt: row.expiresAt,
      accountExists: Boolean(account),
    },
  };
}

export function acceptNewAccount(
  token: string,
  input: { name: string; password: string; authUserId?: string | null; orgId?: string },
  options?: { ip?: string; now?: number },
): { ok: true; actor: Actor } | { ok: false; error: string } {
  const now = options?.now ?? Date.now();
  if (options?.ip && !acceptAllowed(options.ip, now)) return { ok: false, error: ACCEPT_LIMIT };
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Your name must be 2–80 characters." };
  const passwordMessage = passwordError(input.password);
  if (passwordMessage) return { ok: false, error: passwordMessage };
  try {
    const userId = getDb().transaction((tx) => {
      const row = pendingIn(tx, token, now, input.orgId);
      const taken = tx.select().from(users).where(eq(users.email, row.email)).get();
      if (taken) throw new ServiceError("That email already has a Fieldline login. Sign in to accept.");
      const stamp = new Date(now).toISOString();
      const createdId = id("user");
      const salt = newSalt();
      tx.insert(users)
        .values({
          id: createdId,
          name,
          email: row.email,
          passwordHash: hashPassword(input.password, salt),
          passwordSalt: salt,
          title: roleLabel(row.role),
          authUserId: input.authUserId ?? null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .run();
      consume(tx, row, createdId, stamp);
      return createdId;
    });
    const actor = actorFromIds(userId, inviteOrgId(token));
    if (!actor) return { ok: false, error: INVITE_INVALID };
    return { ok: true, actor };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: safeInviteError(error.message) };
    throw error;
  }
}

export function acceptExistingAccount(
  token: string,
  input: { userId: string; orgId?: string },
  options?: { ip?: string; now?: number },
): { ok: true; actor: Actor } | { ok: false; error: string } {
  const now = options?.now ?? Date.now();
  if (options?.ip && !acceptAllowed(options.ip, now)) return { ok: false, error: ACCEPT_LIMIT };
  try {
    const orgId = getDb().transaction((tx) => {
      const row = pendingIn(tx, token, now, input.orgId);
      const user = tx.select().from(users).where(eq(users.id, input.userId)).get();
      if (!user || user.email !== row.email) throw new ServiceError(INVITE_EMAIL);
      consume(tx, row, user.id, new Date(now).toISOString());
      return row.orgId;
    });
    const actor = actorFromIds(input.userId, orgId);
    if (!actor) return { ok: false, error: INVITE_INVALID };
    return { ok: true, actor };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: safeInviteError(error.message) };
    throw error;
  }
}

function inviteOrgId(token: string): string {
  const row = getDb().select().from(teamInvites).where(eq(teamInvites.tokenHash, hashInviteToken(token))).get();
  return row?.orgId || "";
}

function pendingIn(tx: Writer, token: string, now: number, orgId?: string) {
  if (!inviteTokenShape(token)) throw new ServiceError(INVITE_INVALID);
  const row = tx.select().from(teamInvites).where(eq(teamInvites.tokenHash, hashInviteToken(token))).get();
  if (!row || row.status !== "pending" || Date.parse(row.expiresAt) <= now) throw new ServiceError(INVITE_INVALID);
  if (orgId && orgId !== row.orgId) throw new ServiceError(INVITE_INVALID);
  if (!isInviteRole(row.role)) throw new ServiceError(INVITE_INVALID);
  return row;
}

function consume(tx: Writer, row: { id: string; orgId: string; email: string; role: string; expiresAt: string }, userId: string, stamp: string) {
  const updated = tx
    .update(teamInvites)
    .set({ status: "accepted", acceptedBy: userId, acceptedAt: stamp })
    .where(and(eq(teamInvites.id, row.id), eq(teamInvites.status, "pending"), eq(teamInvites.orgId, row.orgId)))
    .run() as { changes?: number };
  if (!updated.changes) throw new ServiceError(INVITE_INVALID);
  const existing = tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, row.orgId), eq(memberships.userId, userId)))
    .get();
  const membershipId = existing?.id || id("mem");
  if (!existing) {
    tx.insert(memberships)
      .values({ id: membershipId, orgId: row.orgId, userId, role: row.role, createdAt: stamp })
      .run();
  }
  trail(tx, row.orgId, membershipId, "accepted", `${row.email} accepted the ${roleLabel(row.role)} invite.`, userId, stamp);
}

function loadPending(token: string, now: number) {
  if (!inviteTokenShape(token)) return null;
  const row = getDb().select().from(teamInvites).where(eq(teamInvites.tokenHash, hashInviteToken(token))).get();
  if (!row || row.status !== "pending" || Date.parse(row.expiresAt) <= now) return null;
  return row;
}

function revokePending(tx: Writer, orgId: string, email: string, actorId: string, stamp: string) {
  const pending = tx
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.orgId, orgId), eq(teamInvites.email, email), eq(teamInvites.status, "pending")))
    .all();
  for (const invite of pending) {
    tx.update(teamInvites)
      .set({ status: "revoked", revokedAt: stamp })
      .where(and(eq(teamInvites.id, invite.id), eq(teamInvites.status, "pending")))
      .run();
    trail(tx, orgId, invite.id, "revoked", `Revoked the invite for ${email}.`, actorId, stamp);
  }
}

function membershipOf(db: Writer, orgId: string, userId: string) {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .get();
}

function assertKeepsOwner(db: Writer, orgId: string, current: string, next: Role | null) {
  if (current !== "owner" || next === "owner") return;
  const owners = db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner"))).all();
  if (owners.length <= 1) throw new ServiceError("This company needs at least one owner.");
}

function trail(tx: Writer, orgId: string, entityId: string, type: string, summary: string, actorId: string, stamp: string) {
  tx.insert(activities)
    .values({
      id: id("act"),
      orgId,
      entityType: "membership",
      entityId,
      type,
      actorType: "user",
      actorId,
      summary,
      payloadJson: null,
      createdAt: stamp,
    })
    .run();
}

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function safeInviteError(message: string) {
  if (message === INVITE_INVALID || message === INVITE_EMAIL || message === ACCEPT_LIMIT) return message;
  if (message.startsWith("That email already")) return message;
  if (message.startsWith("Your name") || message.startsWith("Use a password")) return message;
  return INVITE_INVALID;
}
