import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { hashPassword, newSalt } from "@/lib/auth/password";
import { getDb, type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  estimates,
  leads,
  memberships,
  organizations,
  teamInvites,
  pipelineStages,
  pipelines,
  priceBookItems,
  proposals,
  users,
} from "@/lib/db/schema";
import { STARTER_MARK, starterRows, TRADE_FOCUS } from "@/lib/db/starter";
import { id, nowIso } from "@/lib/ids";
import { DEFAULT_TIME_ZONE, DEFAULT_WEEK_START, isValidTimeZone } from "@/lib/time/calendar";
import { setupChecklist, type ChecklistFacts, type ChecklistStep } from "@/lib/onboarding/checklist";
import { canManageSettings } from "@/lib/permissions";
import { isStarterTrade, type SignupFields, type StarterTrade } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import { authenticate, type Actor } from "@/lib/services/read";

const STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "New", kind: "open" },
  { name: "Contacted", kind: "open" },
  { name: "Site visit", kind: "open" },
  { name: "Estimate sent", kind: "open" },
  { name: "Negotiation", kind: "open" },
  { name: "Won", kind: "won" },
  { name: "Lost", kind: "lost" },
];

export type CompanyResult = { ok: true; actor: Actor } | { ok: false; error: string };

export function emailTaken(email: string): boolean {
  const row = getDb().select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  return Boolean(row);
}

export function createCompany(input: SignupFields & { authUserId?: string | null }): CompanyResult {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (emailTaken(email)) return { ok: false, error: "That email already has a Fieldline account. Sign in instead." };
  if (input.authUserId) {
    const linked = db.select({ id: users.id }).from(users).where(eq(users.authUserId, input.authUserId)).get();
    if (linked) return { ok: false, error: "That login is already linked to a Fieldline company." };
  }
  const orgId = id("org");
  const userId = id("user");
  const now = nowIso();
  const salt = newSalt();
  try {
    db.transaction((tx) => {
      tx.insert(organizations)
        .values({
          id: orgId,
          name: input.companyName,
          slug: uniqueSlug(tx, input.companyName),
          tradeFocus: TRADE_FOCUS[input.trade],
          city: null,
          state: input.state,
          licenseNumber: null,
          marginAlertBps: 2000,
          defaultMarkupBps: 3500,
          taxBps: 0,
          depositBps: 4000,
          progressBps: 4000,
          finalBps: 2000,
          cardEnabled: 1,
          termsVersion: "2026-09-01",
          setupDismissedAt: null,
          timeZone: input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIME_ZONE,
          weekStartsOn:
            input.weekStartsOn != null && Number.isInteger(input.weekStartsOn) && input.weekStartsOn >= 0 && input.weekStartsOn <= 6
              ? input.weekStartsOn
              : DEFAULT_WEEK_START,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(users)
        .values({
          id: userId,
          name: input.ownerName,
          email,
          passwordHash: hashPassword(input.password, salt),
          passwordSalt: salt,
          title: "Owner",
          authUserId: input.authUserId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(memberships)
        .values({ id: id("mem"), orgId, userId, role: "owner", createdAt: now })
        .run();
      const pipelineId = id("pipe");
      tx.insert(pipelines)
        .values({ id: pipelineId, orgId, name: "Sales", createdAt: now, updatedAt: now })
        .run();
      tx.insert(pipelineStages)
        .values(
          STAGES.map((stage, sortOrder) => ({
            id: id("stage"),
            orgId,
            pipelineId,
            name: stage.name,
            sortOrder,
            kind: stage.kind,
            createdAt: now,
          })),
        )
        .run();
      if (input.starter) insertStarterItems(tx, orgId, userId, input.trade);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique/i.test(message)) return { ok: false, error: "That email already has a Fieldline account. Sign in instead." };
    throw error;
  }
  const actor = authenticate(email, input.password);
  if (!actor || actor.orgId !== orgId) return { ok: false, error: "The company was created, but sign-in did not open it." };
  return { ok: true, actor };
}

type Writer = Pick<AppDatabase, "insert" | "select">;

export function insertStarterItems(db: Writer, orgId: string, userId: string, trade: StarterTrade) {
  const now = nowIso();
  db.insert(priceBookItems)
    .values(
      starterRows(trade).map((item) => ({
        id: id("pb"),
        orgId,
        code: item.code,
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitCostCents: item.unitCostCents,
        defaultMarkupBps: 3500,
        vendor: item.vendor,
        keywords: item.keywords,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      })),
    )
    .run();
}

export function addStarterPriceBook(actor: Actor, trade: string) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can add a starter price book.");
  if (!isStarterTrade(trade)) throw new ServiceError("Pick a starter trade.");
  const db = officeOrThrow(actor);
  const existing = db.select({ id: priceBookItems.id }).from(priceBookItems).where(eq(priceBookItems.orgId, actor.orgId)).all();
  if (existing.length > 0) throw new ServiceError("This company already has a price book.");
  insertStarterItems(db, actor.orgId, actor.userId, trade);
}

export function setSetupDismissed(actor: Actor, dismissed: boolean) {
  if (!canManageSettings(actor.role)) throw new ServiceError("Only an owner or admin can change the setup checklist.");
  officeOrThrow(actor)
    .update(organizations)
    .set({ setupDismissedAt: dismissed ? nowIso() : null, updatedAt: nowIso() })
    .where(eq(organizations.id, actor.orgId))
    .run();
}

export function setupFacts(orgId: string): ChecklistFacts | null {
  const db = officeDb(orgId);
  if (!db) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!org) return null;
  const book = db.select({ id: priceBookItems.id }).from(priceBookItems).where(eq(priceBookItems.orgId, orgId)).all();
  const leadRows = db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt)))
    .orderBy(asc(leads.createdAt))
    .all();
  const estimateRows = db
    .select({ id: estimates.id })
    .from(estimates)
    .where(eq(estimates.orgId, orgId))
    .orderBy(asc(estimates.createdAt))
    .all();
  const sent = db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.orgId, orgId), inArray(proposals.status, ["sent", "viewed", "signed"])))
    .all();
  const secret = process.env.STRIPE_SECRET_KEY || "";
  const memberRows = db.select({ id: memberships.id }).from(memberships).where(eq(memberships.orgId, orgId)).all();
  const pendingInvites = db
    .select({ expiresAt: teamInvites.expiresAt })
    .from(teamInvites)
    .where(and(eq(teamInvites.orgId, orgId), eq(teamInvites.status, "pending")))
    .all();
  const teamInvited = memberRows.length > 1 || pendingInvites.some((invite) => Date.parse(invite.expiresAt) > Date.now());
  return {
    licenseNumber: org.licenseNumber,
    priceBookCount: book.length,
    leadCount: leadRows.length,
    estimateCount: estimateRows.length,
    sentProposalCount: sent.length,
    stripeTestKey: secret.startsWith("sk_test_"),
    teamInvited,
    firstLeadId: leadRows[0]?.id ?? null,
    firstEstimateId: estimateRows[0]?.id ?? null,
    dismissed: Boolean(org.setupDismissedAt),
  };
}

export function companyChecklist(orgId: string): { facts: ChecklistFacts; steps: ChecklistStep[] } | null {
  const facts = setupFacts(orgId);
  if (!facts) return null;
  return { facts, steps: setupChecklist(facts) };
}

export function starterMarkVisible(vendor: string | null): boolean {
  return Boolean(vendor?.includes(STARTER_MARK));
}

function officeOrThrow(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function uniqueSlug(db: Writer, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${base}-${randomBytes(3).toString("hex")}`;
    const taken = db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).get();
    if (!taken) return slug;
  }
  return `${base}-${randomBytes(6).toString("hex")}`;
}
