import { and, eq } from "drizzle-orm";
import { type AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  auditLogs,
  bills,
  contacts,
  necW9Requests,
  organizations,
  vendorCertificates,
  vendorCreditApplications,
  vendorPortals,
  vendorTax,
} from "@/lib/db/schema";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, canManageSettings, canSeeMoney, type Role } from "@/lib/permissions";
import { appOrigin } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import {
  boxFigures,
  exemptFromNec,
  filingSeason,
  filingYear,
  isTaxClass,
  maskTin,
  necThresholdCents,
  w9Label,
  w9State,
  type NecPayment,
  type TaxClass,
  type W9State,
} from "@/lib/tax/nec";
import { localDay } from "@/lib/time/calendar";

const VENDOR_TYPES = new Set(["sub", "vendor"]);

export type NecRow = {
  contactId: string;
  name: string;
  legalName: string;
  paidCents: number;
  box1Cents: number;
  cardCents: number;
  over: boolean;
  exempt: boolean;
  w9: W9State;
  w9Label: string;
  tinMask: string;
  requested: boolean;
  portalUrl: string;
  address: string;
};

export type NecReport = {
  year: number;
  thresholdCents: number;
  canEdit: boolean;
  years: number[];
  rows: NecRow[];
  needs: NecRow[];
};

type TaxInput = {
  legalName: string;
  taxClass: string;
  exempt: boolean;
  tin: string;
};

function roleOf(actor: Actor): Role {
  return actor.role as Role;
}

function dbFor(orgId: string): AppDatabase {
  const db = officeDb(orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function assertSee(actor: Actor) {
  if (!canSeeMoney(roleOf(actor))) throw new ServiceError("Your role cannot see this report.");
}

function assertOffice(actor: Actor) {
  if (!canManageMoney(roleOf(actor))) throw new ServiceError("1099 is for the office.");
}

function orgToday(db: AppDatabase, orgId: string): string {
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function cleanYear(year: number): number {
  const value = Math.trunc(year);
  if (value < 2000 || value > 2100) throw new ServiceError("Pick a year.");
  return value;
}

function addressOf(row: { address: string | null; city: string | null; state: string | null; zip: string | null }): string {
  const city = [row.city, row.state, row.zip].filter(Boolean).join(" ");
  return [row.address, city].filter(Boolean).join(", ");
}

function portalUrl(token: string | null | undefined): string {
  if (!token) return "";
  const origin = appOrigin(process.env);
  return `${origin ?? ""}/v/${token}`;
}

function storeTin(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length !== 9) throw new ServiceError("TIN needs 9 digits.");
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function rowsFor(orgId: string, year: number, today: string): NecRow[] {
  const db = dbFor(orgId);
  const people = db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .all()
    .filter((row) => !row.deletedAt && VENDOR_TYPES.has(row.type));
  const tax = new Map(db.select().from(vendorTax).where(eq(vendorTax.orgId, orgId)).all().map((row) => [row.contactId, row]));
  const certs = db
    .select()
    .from(vendorCertificates)
    .where(and(eq(vendorCertificates.orgId, orgId), eq(vendorCertificates.type, "w9")))
    .all();
  const w9 = new Map(certs.map((row) => [row.contactId, row.expiresOn]));
  const requested = new Set(
    db
      .select()
      .from(necW9Requests)
      .where(and(eq(necW9Requests.orgId, orgId), eq(necW9Requests.year, year)))
      .all()
      .map((row) => row.contactId),
  );
  const portals = new Map(
    db
      .select()
      .from(vendorPortals)
      .where(eq(vendorPortals.orgId, orgId))
      .all()
      .map((row) => [row.contactId, row.issuedToken]),
  );
  const credits = new Map<string, number>();
  for (const row of db.select().from(vendorCreditApplications).where(eq(vendorCreditApplications.orgId, orgId)).all()) {
    credits.set(row.billId, (credits.get(row.billId) ?? 0) + row.amountCents);
  }
  const paid = db
    .select()
    .from(bills)
    .where(eq(bills.orgId, orgId))
    .all()
    .filter((row) => row.status === "paid" && row.vendorContactId && (row.paidAt ?? "").startsWith(String(year)));
  const byVendor = new Map<string, NecPayment[]>();
  for (const bill of paid) {
    const contactId = bill.vendorContactId as string;
    const list = byVendor.get(contactId) ?? [];
    list.push({
      paidOn: (bill.paidAt ?? "").slice(0, 10),
      status: bill.status,
      amountCents: bill.amountCents,
      retainageCents: bill.retainageCents,
      kind: bill.kind,
      method: bill.payMethod,
      creditCents: credits.get(bill.id) ?? 0,
    });
    byVendor.set(contactId, list);
  }
  const threshold = necThresholdCents(year);
  const rows: NecRow[] = [];
  for (const person of people) {
    const payments = byVendor.get(person.id);
    if (!payments?.length) continue;
    const profile = tax.get(person.id);
    const figures = boxFigures(payments, year);
    const exempt = exemptFromNec(profile?.taxClass, profile?.exempt === 1);
    const box1Cents = exempt ? 0 : figures.cashCents;
    const state = w9State(w9.get(person.id), today);
    const legal = profile?.legalName?.trim() || person.company || person.name;
    rows.push({
      contactId: person.id,
      name: person.company || person.name,
      legalName: legal,
      paidCents: figures.cashCents + figures.cardCents,
      box1Cents,
      cardCents: figures.cardCents,
      over: box1Cents >= threshold,
      exempt,
      w9: state,
      w9Label: w9Label(state),
      tinMask: maskTin(profile?.tin),
      requested: requested.has(person.id),
      portalUrl: portalUrl(portals.get(person.id)),
      address: addressOf(person),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.contactId.localeCompare(b.contactId));
}

function yearChoices(orgId: string, current: number): number[] {
  const db = dbFor(orgId);
  const years = new Set<number>([current, 2025, 2026]);
  for (const bill of db.select({ paidAt: bills.paidAt }).from(bills).where(eq(bills.orgId, orgId)).all()) {
    const year = Number((bill.paidAt ?? "").slice(0, 4));
    if (year >= 2000 && year <= 2100) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export function necReport(actor: Actor, year: number): NecReport {
  assertSee(actor);
  const value = cleanYear(year);
  const db = dbFor(actor.orgId);
  const today = orgToday(db, actor.orgId);
  const current = Number(today.slice(0, 4));
  const rows = rowsFor(actor.orgId, value, today);
  return {
    year: value,
    thresholdCents: necThresholdCents(value),
    canEdit: canManageMoney(roleOf(actor)),
    years: yearChoices(actor.orgId, current),
    rows,
    needs: rows.filter((row) => row.over && (row.w9 === "missing" || row.w9 === "stale")),
  };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function necCsv(actor: Actor, year: number): string {
  assertSee(actor);
  const value = cleanYear(year);
  const db = dbFor(actor.orgId);
  const today = orgToday(db, actor.orgId);
  const filing = rowsFor(actor.orgId, value, today).filter((row) => row.over && !row.exempt);
  const fullTin = canManageSettings(roleOf(actor));
  const tins = new Map(
    fullTin ? db.select().from(vendorTax).where(eq(vendorTax.orgId, actor.orgId)).all().map((row) => [row.contactId, row.tin]) : [],
  );
  const lines = [["Year", "Legal name", "TIN", "Address", "Box 1"]];
  for (const row of filing.sort((a, b) => a.legalName.localeCompare(b.legalName))) {
    lines.push([String(value), row.legalName, fullTin ? (tins.get(row.contactId) ?? "") : "", row.address, (row.box1Cents / 100).toFixed(2)]);
  }
  return lines.map((line) => line.map(csvCell).join(",")).join("\n");
}

export function necAttention(orgId: string, today?: string): { count: number; href: string | null } {
  const db = officeDb(orgId);
  if (!db) return { count: 0, href: null };
  const day = today ?? orgToday(db, orgId);
  const year = filingYear(day);
  if (!filingSeason(day) || year == null) return { count: 0, href: null };
  const count = rowsFor(orgId, year, day).filter((row) => row.over && (row.w9 === "missing" || row.w9 === "stale")).length;
  if (count === 0) return { count: 0, href: null };
  return { count, href: `/reports/nec?year=${year}` };
}

export function vendorTaxForm(actor: Actor, contactId: string) {
  if (!canSeeMoney(roleOf(actor))) return null;
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, contactId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) return null;
  const row = db.select().from(vendorTax).where(and(eq(vendorTax.orgId, actor.orgId), eq(vendorTax.contactId, contactId))).get();
  return {
    legalName: row?.legalName ?? "",
    taxClass: row?.taxClass ?? "",
    exempt: row?.exempt === 1,
    tinMask: maskTin(row?.tin),
    canEdit: canManageMoney(roleOf(actor)),
  };
}

export function saveVendorTax(actor: Actor, contactId: string, input: TaxInput) {
  assertOffice(actor);
  const db = dbFor(actor.orgId);
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, contactId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) throw new ServiceError("That vendor is not in your company.");
  const legalName = input.legalName.trim().slice(0, 120);
  const taxClass = input.taxClass.trim();
  if (taxClass && !isTaxClass(taxClass)) throw new ServiceError("Pick a tax classification.");
  const existing = db.select().from(vendorTax).where(and(eq(vendorTax.orgId, actor.orgId), eq(vendorTax.contactId, contactId))).get();
  const tin = input.tin.trim() ? storeTin(input.tin) : (existing?.tin ?? "");
  const exempt = taxClass === "attorney" ? 0 : input.exempt ? 1 : 0;
  const now = nowIso();
  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    if (existing) {
      database
        .update(vendorTax)
        .set({ legalName, tin, taxClass, exempt, updatedAt: now })
        .where(and(eq(vendorTax.orgId, actor.orgId), eq(vendorTax.id, existing.id)))
        .run();
    } else {
      database
        .insert(vendorTax)
        .values({ id: id("vtax"), orgId: actor.orgId, contactId, legalName, tin, taxClass, exempt, updatedAt: now })
        .run();
    }
    database
      .insert(auditLogs)
      .values({
        id: id("audit"),
        orgId: actor.orgId,
        actorId: actor.userId,
        action: "vendor.tax",
        entityType: "contact",
        entityId: contactId,
        payloadJson: JSON.stringify({ taxClass, exempt }),
        ip: null,
        createdAt: now,
      })
      .run();
  });
}

export function markNecRequested(actor: Actor, contactId: string, year: number) {
  assertOffice(actor);
  const value = cleanYear(year);
  const db = dbFor(actor.orgId);
  const contact = db.select().from(contacts).where(and(eq(contacts.orgId, actor.orgId), eq(contacts.id, contactId))).get();
  if (!contact || contact.deletedAt || !VENDOR_TYPES.has(contact.type)) throw new ServiceError("That vendor is not in your company.");
  const now = nowIso();
  const existing = db
    .select()
    .from(necW9Requests)
    .where(and(eq(necW9Requests.orgId, actor.orgId), eq(necW9Requests.contactId, contactId), eq(necW9Requests.year, value)))
    .get();
  if (existing) return;
  db.insert(necW9Requests)
    .values({ id: id("nec"), orgId: actor.orgId, contactId, year: value, requestedAt: now, requestedBy: actor.userId })
    .run();
}

export function currentNecYear(orgId: string): number {
  const db = officeDb(orgId);
  if (!db) return new Date().getFullYear();
  return Number(orgToday(db, orgId).slice(0, 4));
}

export type { TaxClass };
