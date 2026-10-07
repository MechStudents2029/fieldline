import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { addMonths } from "@/lib/closeout/check";
import { addCalendarDays, localDay, localWeek, zonedTimeToUtc } from "@/lib/time/calendar";
import { northlineCatalog, riveraCatalog } from "@/lib/db/catalog";
import {
  activities,
  aiRuns,
  appMeta,
  auditLogs,
  billEvents,
  billLines,
  bills,
  budgetLines,
  changeOrderLines,
  changeOrders,
  consents,
  contacts,
  costItems,
  documents,
  estimateSections,
  estimates,
  followUpDrafts,
  integrationConnections,
  invoiceLines,
  invoices,
  laborRates,
  leads,
  lineItems,
  memberships,
  messageThreads,
  messages,
  organizations,
  payments,
  pipelineStages,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrders,
  scheduleAssignees,
  scheduleItems,
  selectionChoices,
  selectionEvents,
  selections,
  leadFormSubmissions,
  leadForms,
  pipelines,
  priceBookItems,
  projects,
  punchItems,
  warrantyRequests,
  proposals,
  signatures,
  tasks,
  dailyLogEvents,
  dailyLogPhotos,
  dailyLogs,
  timeApprovals,
  timeEntries,
  timeEntryEvents,
  users,
  vendorCertificates,
  vendorPortals,
} from "@/lib/db/schema";
import { assembleSnapshot, defaultSchedule, type StoredSnapshot } from "@/lib/domain/snapshot";
import { vasquezLines, vasquezSections } from "@/lib/estimate/vasquez";
import { hashPassword, newSalt } from "@/lib/auth/password";
import { canonicalJson, sha256 } from "@/lib/esign/hash";
import { publicSnapshot } from "@/lib/selections/money";
import { daysAgo, daysFromNow, nowIso } from "@/lib/ids";
import { achFeeCents, qtyToMilli } from "@/lib/money";
import { CONSENT_VERSION, DEMO_PASSWORD } from "@/lib/product";
import { hashVendorToken, DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import { proposalNudgeCopy } from "@/lib/ai/nurture";
import {
  defaultFields,
  DEMO_NORTH_FORM_TOKEN,
  DEMO_RIVERA_FORM_TOKEN,
  WEBSITE_FORM_SOURCE,
} from "@/lib/lead-form/rules";

export const SEED_VERSION = "16";

const ORG = "org_rivera";
const NORTH = "org_northline";

function wipe(sqlite: Database.Database, dialect: "sqlite" | "postgres") {
  if (dialect === "postgres") {
    const tables = sqlite
      .prepare(
        "select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
      )
      .all() as { name: string }[];
    if (tables.length === 0) return;
    const list = tables.map((table) => `"${table.name.replace(/"/g, "")}"`).join(", ");
    sqlite.exec(`truncate table ${list} restart identity cascade`);
    return;
  }
  sqlite.pragma("foreign_keys = OFF");
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[];
  for (const table of tables) sqlite.exec(`delete from "${table.name}"`);
  sqlite.pragma("foreign_keys = ON");
}

function userRow(id: string, name: string, email: string, title: string, createdAt: string) {
  const salt = newSalt();
  return {
    id,
    name,
    email,
    passwordHash: hashPassword(DEMO_PASSWORD, salt),
    passwordSalt: salt,
    title,
    createdAt,
    updatedAt: createdAt,
  };
}

export function seedDatabase(db: AppDatabase, sqlite: Database.Database, dialect: "sqlite" | "postgres" = "sqlite") {
  wipe(sqlite, dialect);
  const now = nowIso();
  const created = daysAgo(140);

  db.insert(organizations)
    .values([
      {
        id: ORG,
        name: "Rivera Remodeling & Trade",
        slug: "rivera",
        tradeFocus: "Kitchens, baths, and light additions",
        city: "Oakland",
        state: "CA",
        licenseNumber: "Demo CSLB 000000",
        marginAlertBps: 2000,
        defaultMarkupBps: 3500,
        taxBps: 0,
        depositBps: 4000,
        progressBps: 4000,
        finalBps: 2000,
        cardEnabled: 1,
        termsVersion: "2026-09-01",
        timeZone: "America/New_York",
        weekStartsOn: 1,
        warrantyMonths: 12,
        vendorComplianceMode: "warn",
        vendorRequiredTypes: "general_liability,workers_comp",
        createdAt: created,
        updatedAt: now,
      },
      {
        id: NORTH,
        name: "Northline Electric",
        slug: "northline",
        tradeFocus: "Residential electrical",
        city: "Berkeley",
        state: "CA",
        licenseNumber: "Demo CSLB 000111",
        marginAlertBps: 2000,
        defaultMarkupBps: 4000,
        taxBps: 0,
        depositBps: 5000,
        progressBps: 5000,
        finalBps: 0,
        cardEnabled: 1,
        termsVersion: "2026-09-01",
        timeZone: "America/Los_Angeles",
        weekStartsOn: 1,
        warrantyMonths: 12,
        vendorComplianceMode: "warn",
        vendorRequiredTypes: "general_liability,workers_comp",
        createdAt: created,
        updatedAt: now,
      },
    ])
    .run();

  db.insert(users)
    .values([
      userRow("user_maya", "Maya Rivera", "maya@rivera.demo", "Owner", created),
      userRow("user_luis", "Luis Ortega", "luis@rivera.demo", "Estimator", created),
      userRow("user_dana", "Dana Cho", "dana@rivera.demo", "Field lead", created),
      userRow("user_sam", "Sam Patel", "sam@rivera.demo", "Office admin", created),
      userRow("user_riley", "Riley Nguyen", "riley@rivera.demo", "Bookkeeper", created),
      userRow("user_jordan", "Jordan Hale", "jordan@northline.demo", "Owner", created),
    ])
    .run();

  db.insert(memberships)
    .values([
      { id: "mem_maya", orgId: ORG, userId: "user_maya", role: "owner", createdAt: created },
      { id: "mem_luis", orgId: ORG, userId: "user_luis", role: "estimator", createdAt: created },
      { id: "mem_dana", orgId: ORG, userId: "user_dana", role: "field", createdAt: created },
      { id: "mem_sam", orgId: ORG, userId: "user_sam", role: "admin", createdAt: created },
      { id: "mem_riley", orgId: ORG, userId: "user_riley", role: "viewer", createdAt: created },
      { id: "mem_jordan", orgId: NORTH, userId: "user_jordan", role: "owner", createdAt: created },
    ])
    .run();

  db.insert(pipelines)
    .values([
      { id: "pipe_rivera", orgId: ORG, name: "Remodel sales", createdAt: created, updatedAt: now },
      { id: "pipe_north", orgId: NORTH, name: "Service sales", createdAt: created, updatedAt: now },
    ])
    .run();

  const stage = (
    id: string,
    orgId: string,
    pipelineId: string,
    name: string,
    sortOrder: number,
    kind: string,
  ) => ({ id, orgId, pipelineId, name, sortOrder, kind, createdAt: created });

  db.insert(pipelineStages)
    .values([
      stage("stage_new", ORG, "pipe_rivera", "New", 0, "open"),
      stage("stage_contacted", ORG, "pipe_rivera", "Contacted", 1, "open"),
      stage("stage_visit", ORG, "pipe_rivera", "Site visit", 2, "open"),
      stage("stage_sent", ORG, "pipe_rivera", "Estimate sent", 3, "open"),
      stage("stage_negotiation", ORG, "pipe_rivera", "Negotiation", 4, "open"),
      stage("stage_won", ORG, "pipe_rivera", "Won", 5, "won"),
      stage("stage_lost", ORG, "pipe_rivera", "Lost", 6, "lost"),
      stage("stage_n_new", NORTH, "pipe_north", "New", 0, "open"),
      stage("stage_n_won", NORTH, "pipe_north", "Won", 1, "won"),
    ])
    .run();

  type ContactSeed = {
    id: string;
    type: string;
    name: string;
    company?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    notes?: string;
  };

  const people: ContactSeed[] = [
    { id: "c_vasquez", type: "client", name: "Elena Vasquez", email: "elena.vasquez@example.com", phone: "(510) 555-0142", address: "240 Hillcrest Ave", city: "Oakland", notes: "Gut kitchen. Budget she named: $60–80k." },
    { id: "c_briggs", type: "client", name: "Tom Briggs", email: "tom.briggs@example.com", phone: "(510) 555-0177", address: "88 Brook St", city: "Alameda" },
    { id: "c_cho", type: "client", name: "Helen Cho", email: "helen.cho@example.com", phone: "(510) 555-0190", address: "15 Lakeview Rd", city: "Piedmont" },
    { id: "c_chen", type: "client", name: "Mei Chen", email: "mei.chen@example.com", phone: "(510) 555-0114", address: "18 Orchard Ave", city: "Oakland" },
    { id: "c_okonkwo", type: "client", name: "Amara Okonkwo", email: "amara.okonkwo@example.com", phone: "(510) 555-0166", address: "901 Mandana Blvd", city: "Oakland" },
    { id: "c_brooks", type: "client", name: "Chris Brooks", email: "chris.brooks@example.com", phone: "(510) 555-0133", address: "44 Canyon Rd", city: "Orinda" },
    { id: "c_diaz", type: "client", name: "Rosa Diaz", email: "rosa.diaz@example.com", phone: "(510) 555-0188", address: "602 Santa Clara Ave", city: "Alameda" },
    { id: "c_webb", type: "client", name: "Marcus Webb", email: "marcus.webb@example.com", phone: "(510) 555-0108", address: "77 Telegraph Ave", city: "Oakland" },
    { id: "c_shah", type: "client", name: "Priya Shah", email: "priya.shah@example.com", phone: "(415) 555-0144", address: "9 Belvedere St", city: "San Francisco" },
    { id: "c_park", type: "client", name: "Nina Park", email: "nina.park@example.com", phone: "(510) 555-0121", address: "300 Grand Ave", city: "Oakland" },
    { id: "c_romero", type: "client", name: "Luis Romero", email: "luis.romero@example.com", phone: "(510) 555-0199", address: "12 Summit Dr", city: "El Cerrito" },
    { id: "c_haddad", type: "client", name: "Omar Haddad", email: "omar.haddad@example.com", phone: "(510) 555-0155", address: "55 Adeline St", city: "Oakland" },
    { id: "c_sofia", type: "client", name: "Sofia Alvarez", email: "sofia.alvarez@example.com", phone: "(510) 555-0101", city: "Oakland" },
    { id: "c_james", type: "client", name: "James Porter", email: "james.porter@example.com", phone: "(925) 555-0170", city: "Walnut Creek" },
    { id: "c_ruth", type: "client", name: "Ruth Feldman", email: "ruth.feldman@example.com", phone: "(510) 555-0160", city: "Berkeley" },
    { id: "c_patrick", type: "client", name: "Patrick Nguyen", email: "patrick.nguyen@example.com", phone: "(510) 555-0148", city: "Oakland" },
    { id: "c_wendy", type: "client", name: "Wendy Cho", email: "wendy.cho@example.com", phone: "(510) 555-0138", city: "Alameda" },
    { id: "c_derek", type: "client", name: "Derek Holt", email: "derek.holt@example.com", phone: "(510) 555-0129", city: "Oakland" },
    { id: "c_ana", type: "client", name: "Ana Silva", email: "ana.silva@example.com", phone: "(415) 555-0182", city: "San Francisco" },
    { id: "c_casa", type: "sub", name: "Imani Brooks", company: "Casa Tile", email: "imani@casatile.example", phone: "(510) 555-0201", notes: "Tile sub. Net 15." },
    { id: "c_harbor", type: "sub", name: "Pete Alvarez", company: "Harbor Plumbing", email: "pete@harbor.example", phone: "(510) 555-0202" },
    { id: "c_brighton", type: "sub", name: "Noah Kim", company: "Brighton Electric", email: "noah@brighton.example", phone: "(510) 555-0203" },
    { id: "c_summit", type: "vendor", name: "Gail Nguyen", company: "Summit Lumber", email: "gail@summit.example", phone: "(510) 555-0301" },
    { id: "c_slab", type: "vendor", name: "Owen Clarke", company: "Slab House", email: "owen@slabhouse.example", phone: "(510) 555-0302" },
    { id: "c_mill", type: "vendor", name: "Fran Doyle", company: "Mill & Co Cabinets", email: "fran@millco.example", phone: "(510) 555-0303" },
    { id: "c_ellis", type: "client", name: "Nora Ellis", email: "nora.ellis@example.com", phone: "(510) 555-0194", address: "18 Maple St", city: "Oakland" },
  ];

  db.insert(contacts)
    .values(
      people.map((person) => ({
        id: person.id,
        orgId: ORG,
        type: person.type,
        name: person.name,
        company: person.company ?? null,
        email: person.email ?? null,
        phone: person.phone ?? null,
        address: person.address ?? null,
        city: person.city ?? null,
        state: "CA",
        zip: null,
        notes: person.notes ?? null,
        deletedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_maya",
      })),
    )
    .run();

  db.insert(contacts)
    .values([
      {
        id: "c_north_ada",
        orgId: NORTH,
        type: "client",
        name: "Ada Mensah",
        company: null,
        email: "ada.mensah@example.com",
        phone: "(510) 555-0401",
        address: "3 Virginia St",
        city: "Berkeley",
        state: "CA",
        zip: null,
        notes: null,
        deletedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_jordan",
      },
      {
        id: "c_north_supply",
        orgId: NORTH,
        type: "vendor",
        name: "Bay Wire Supply",
        company: "Bay Wire Supply",
        email: "orders@baywire.example",
        phone: null,
        address: null,
        city: "Oakland",
        state: "CA",
        zip: null,
        notes: null,
        deletedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_jordan",
      },
    ])
    .run();

  db.insert(consents)
    .values(
      people
        .filter((person) => person.type === "client" && person.email)
        .flatMap((person) => [
          {
            id: `consent_email_${person.id}`,
            orgId: ORG,
            contactId: person.id,
            channel: "email",
            status: "opt_in",
            source: "intake",
            createdAt: created,
          },
          {
            id: `consent_sms_${person.id}`,
            orgId: ORG,
            contactId: person.id,
            channel: "sms",
            status: person.id === "c_park" ? "opt_out" : "opt_in",
            source: person.id === "c_park" ? "STOP" : "intake",
            createdAt: created,
          },
        ]),
    )
    .run();

  const book = riveraCatalog();
  db.insert(priceBookItems)
    .values(
      book.map((item) => ({
        id: `pb_${item.code.toLowerCase()}`,
        orgId: ORG,
        code: item.code,
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitCostCents: item.unitCostCents,
        defaultMarkupBps: 3500,
        vendor: item.vendor,
        keywords: item.keywords,
        lastUsedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_luis",
      })),
    )
    .run();

  db.insert(priceBookItems)
    .values(
      northlineCatalog().map((item) => ({
        id: `npb_${item.code.toLowerCase()}`,
        orgId: NORTH,
        code: item.code,
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitCostCents: item.unitCostCents,
        defaultMarkupBps: 4000,
        vendor: item.vendor,
        keywords: item.keywords,
        lastUsedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_jordan",
      })),
    )
    .run();

  const vasquezScope =
    "Elena Vasquez, 240 sq ft kitchen, gut, new cabinets, quartz, 14 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights. Budget $60–80k. 240 Hillcrest Ave, Oakland.";

  type LeadSeed = {
    id: string;
    contactId: string;
    stageId: string;
    title: string;
    source: string;
    value: number | null;
    status: string;
    owner: string;
    scope: string | null;
    sqft: number | null;
    updated: string;
    lost?: string;
  };

  const leadRows: LeadSeed[] = [
    { id: "lead_vasquez", contactId: "c_vasquez", stageId: "stage_visit", title: "Vasquez gut kitchen", source: "referral", value: 7000000, status: "open", owner: "user_luis", scope: vasquezScope, sqft: 240, updated: daysAgo(1) },
    { id: "lead_webb", contactId: "c_webb", stageId: "stage_new", title: "Webb basement finish", source: "website", value: 4500000, status: "open", owner: "user_maya", scope: "Marcus Webb wants a basement finish, about 600 sq ft, bath and a bedroom.", sqft: 600, updated: daysAgo(8) },
    { id: "lead_shah", contactId: "c_shah", stageId: "stage_contacted", title: "Shah backyard ADU", source: "google", value: 18000000, status: "open", owner: "user_maya", scope: "Priya Shah asked about a 500 sq ft backyard ADU. Early conversation.", sqft: 500, updated: daysAgo(2) },
    { id: "lead_briggs", contactId: "c_briggs", stageId: "stage_sent", title: "Briggs deck stain", source: "repeat", value: 496800, status: "open", owner: "user_luis", scope: "Restain the existing 320 sq ft deck. No structural work.", sqft: 320, updated: daysAgo(4) },
    { id: "lead_cho", contactId: "c_cho", stageId: "stage_negotiation", title: "Cho primary bath", source: "home show", value: 3800000, status: "open", owner: "user_luis", scope: "Helen Cho is comparing a primary bath remodel. Shower glass is the open item.", sqft: 80, updated: daysAgo(2) },
    { id: "lead_chen", contactId: "c_chen", stageId: "stage_won", title: "Chen powder room", source: "referral", value: 1840000, status: "won", owner: "user_maya", scope: "Powder room refresh.", sqft: 35, updated: daysAgo(6) },
    { id: "lead_okonkwo", contactId: "c_okonkwo", stageId: "stage_won", title: "Okonkwo primary bath", source: "referral", value: 4620000, status: "won", owner: "user_luis", scope: "Primary bath, shower tile, new vanity.", sqft: 90, updated: daysAgo(20) },
    { id: "lead_brooks", contactId: "c_brooks", stageId: "stage_won", title: "Brooks family room addition", source: "yard sign", value: 8600000, status: "won", owner: "user_maya", scope: "Family room addition. Framing is running hot.", sqft: 280, updated: daysAgo(15) },
    { id: "lead_diaz", contactId: "c_diaz", stageId: "stage_won", title: "Diaz deck replacement", source: "repeat", value: 2400000, status: "won", owner: "user_luis", scope: "Replace the rear deck.", sqft: 280, updated: daysAgo(40) },
    { id: "lead_park", contactId: "c_park", stageId: "stage_lost", title: "Park kitchen", source: "angi", value: 5200000, status: "lost", owner: "user_luis", scope: "Kitchen remodel. Lost on price.", sqft: 180, updated: daysAgo(18), lost: "Went with a lower bid" },
    { id: "lead_romero", contactId: "c_romero", stageId: "stage_visit", title: "Romero roof", source: "google", value: 1600000, status: "open", owner: "user_maya", scope: "Luis Romero, roof replacement, about 18 squares.", sqft: 18, updated: daysAgo(3) },
    { id: "lead_haddad", contactId: "c_haddad", stageId: "stage_contacted", title: "Haddad panel upgrade", source: "neighbor", value: 480000, status: "open", owner: "user_sam", scope: "Omar Haddad needs a panel upgrade before a kitchen. Referred to Northline if he only wants electrical.", sqft: null, updated: daysAgo(1) },
  ];

  db.insert(leads)
    .values(
      leadRows.map((lead) => ({
        id: lead.id,
        orgId: ORG,
        contactId: lead.contactId,
        stageId: lead.stageId,
        title: lead.title,
        source: lead.source,
        valueEstCents: lead.value,
        ownerUserId: lead.owner,
        status: lead.status,
        lostReason: lead.lost ?? null,
        scopeText: lead.scope,
        sqft: lead.sqft,
        deletedAt: null,
        createdAt: daysAgo(30),
        updatedAt: lead.updated,
        createdBy: lead.owner,
      })),
    )
    .run();

  db.insert(leads)
    .values({
      id: "lead_north_ada",
      orgId: NORTH,
      contactId: "c_north_ada",
      stageId: "stage_n_new",
      title: "Mensah EV charger",
      source: "referral",
      valueEstCents: 180000,
      ownerUserId: "user_jordan",
      status: "open",
      lostReason: null,
      scopeText: "Install a wall charger on a new circuit.",
      sqft: null,
      deletedAt: null,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(1),
      createdBy: "user_jordan",
    })
    .run();

  db.insert(leads)
    .values({
      id: "lead_web_ellis",
      orgId: ORG,
      contactId: "c_ellis",
      stageId: "stage_new",
      title: "Nora Ellis Bath remodel",
      source: WEBSITE_FORM_SOURCE,
      valueEstCents: null,
      ownerUserId: null,
      status: "open",
      lostReason: null,
      scopeText: "Bath remodel\n18 Maple St\nBudget $25–50k\nTimeline 1–3 months\nPrimary bath, about 80 sq ft, new tile.",
      sqft: 80,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
    })
    .run();

  const schedule = defaultSchedule({ depositBps: 4000, progressBps: 4000, finalBps: 2000 });

  function priced(name: string, priceCents: number, costCents: number, code: string | null = null) {
    return { name, priceCents, costCents, costCode: code, qtyMilli: 1000, unit: "ls" };
  }

  function pack(input: {
    title: string;
    clientName: string;
    address: string;
    rows: ReturnType<typeof priced>[];
  }): StoredSnapshot {
    const subtotal = input.rows.reduce((sum, row) => sum + row.priceCents, 0);
    const stored: StoredSnapshot = {
      public: {
        title: input.title,
        company: "Rivera Remodeling & Trade",
        clientName: input.clientName,
        address: input.address,
        sections: [
          {
            name: "Scope",
            lines: input.rows.map((row) => ({
              name: row.name,
              qty: "1",
              unit: "ls",
              unitPriceCents: row.priceCents,
              priceCents: row.priceCents,
            })),
          },
        ],
        subtotalCents: subtotal,
        taxCents: 0,
        totalCents: subtotal,
        schedule: [
          { type: "deposit", label: schedule[0].label, bps: 4000, amountCents: Math.round(subtotal * 0.4) },
          { type: "progress", label: schedule[1].label, bps: 4000, amountCents: Math.round(subtotal * 0.4) },
          {
            type: "final",
            label: schedule[2].label,
            bps: 2000,
            amountCents: subtotal - Math.round(subtotal * 0.4) * 2,
          },
        ],
        termsVersion: "2026-09-01",
        disclaimer:
          "Historical demo proposal. Allowances are fixed at the amounts below. Hidden conditions require a change order.",
      },
      lines: input.rows.map((row) => ({
        name: row.name,
        costCode: row.costCode,
        costCents: row.costCents,
        priceCents: row.priceCents,
        qtyMilli: 1000,
        unit: "ls",
      })),
    };
    return stored;
  }

  const briggsLines = [
    { name: "Wash and brighten existing deck", qtyMilli: qtyToMilli(320), unit: "sf", unitCostCents: 350, markupBps: 3500, costCode: "DECK-BOARD" },
    { name: "Solid stain, two coats", qtyMilli: qtyToMilli(320), unit: "sf", unitCostCents: 800, markupBps: 3500, costCode: "PNT-EXT" },
  ];
  const briggsSnap = assembleSnapshot({
    title: "Briggs deck stain",
    company: "Rivera Remodeling & Trade",
    clientName: "Tom Briggs",
    address: "88 Brook St, Alameda, CA",
    sections: [{ name: "Deck", lines: briggsLines }],
    taxBps: 0,
    scheduleParts: schedule,
  });

  db.insert(estimates)
    .values({
      id: "est_briggs",
      orgId: ORG,
      leadId: "lead_briggs",
      version: 1,
      status: "sent",
      title: "Briggs deck stain",
      markupBps: 3500,
      taxBps: 0,
      marginTargetBps: 2000,
      notes: "No boards replaced. If we find rot, that is a change order.",
      createdAt: daysAgo(5),
      updatedAt: daysAgo(4),
      createdBy: "user_luis",
    })
    .run();
  db.insert(estimateSections)
    .values({ id: "sec_briggs", orgId: ORG, estimateId: "est_briggs", name: "Deck", sortOrder: 0 })
    .run();
  db.insert(lineItems)
    .values(
      briggsLines.map((line, index) => ({
        id: `li_briggs_${index}`,
        orgId: ORG,
        sectionId: "sec_briggs",
        estimateId: "est_briggs",
        priceBookItemId: null,
        name: line.name,
        description: null,
        qtyMilli: line.qtyMilli,
        unit: line.unit,
        unitCostCents: line.unitCostCents,
        markupBps: line.markupBps,
        costCode: line.costCode,
        source: "manual",
        aiConfidenceMilli: null,
        sourceNote: null,
        sortOrder: index,
      })),
    )
    .run();

  db.insert(estimates)
    .values({
      id: "est_vasquez",
      orgId: ORG,
      leadId: "lead_vasquez",
      version: 2,
      status: "draft",
      title: "Vasquez gut kitchen",
      markupBps: 4286,
      taxBps: 0,
      marginTargetBps: 3000,
      notes: null,
      createdAt: daysAgo(1),
      updatedAt: now,
      createdBy: "user_luis",
    })
    .run();
  db.insert(estimateSections)
    .values(vasquezSections.map((section) => ({ id: section.id, orgId: ORG, estimateId: "est_vasquez", name: section.name, sortOrder: section.sortOrder })))
    .run();
  db.insert(lineItems)
    .values(
      vasquezLines.map((line) => ({
        id: line.id,
        orgId: ORG,
        sectionId: line.sectionId,
        estimateId: "est_vasquez",
        priceBookItemId: `pb_${line.code.toLowerCase()}`,
        name: line.name,
        description: null,
        qtyMilli: qtyToMilli(line.qty),
        unit: line.unit,
        unitCostCents: line.unitCostCents,
        markupBps: line.markupBps,
        costCode: line.code,
        source: line.confidenceMilli != null ? "ai" : "manual",
        aiConfidenceMilli: line.confidenceMilli,
        sourceNote: line.sourceNote,
        sortOrder: line.sortOrder,
        billing: line.billing,
      })),
    )
    .run();

  db.insert(proposals)
    .values({
      id: "prop_briggs",
      orgId: ORG,
      estimateId: "est_briggs",
      leadId: "lead_briggs",
      projectId: null,
      status: "viewed",
      publicToken: "demo_proposal_briggs",
      snapshotJson: JSON.stringify(briggsSnap),
      paymentScheduleJson: JSON.stringify(briggsSnap.public.schedule),
      termsVersion: "2026-09-01",
      totalCents: briggsSnap.public.totalCents,
      sentAt: daysAgo(4),
      viewedAt: daysAgo(3),
      signedAt: null,
      declinedAt: null,
      expiresAt: daysFromNow(26),
      createdAt: daysAgo(4),
      updatedAt: daysAgo(3),
      createdBy: "user_luis",
    })
    .run();

  const jobs: {
    id: string;
    leadId: string;
    proposalId: string;
    contactId: string;
    name: string;
    status: string;
    address: string;
    token: string;
    start: string;
    snap: StoredSnapshot;
    client: string;
  }[] = [];

  const historical: Array<{
    id: string;
    leadId: string;
    contactId: string;
    name: string;
    status: string;
    address: string;
    token: string;
    client: string;
    startDays: number;
    rows: ReturnType<typeof priced>[];
  }> = [
    {
      id: "proj_chen",
      leadId: "lead_chen",
      contactId: "c_chen",
      name: "Chen powder room",
      status: "active",
      address: "18 Orchard Ave, Oakland, CA",
      token: "demo_portal_chen",
      client: "Mei Chen",
      startDays: 3,
      rows: [
        priced("Demo and haul-off", 120000, 70000, "DEMO-GUT"),
        priced("Vanity and top", 640000, 420000, "BATH-VANITY"),
        priced("Toilet and plumbing", 280000, 190000, "PLB-TOILET"),
        priced("Tile, paint, and accessories", 520000, 340000, "TILE-FLR"),
        priced("Supervision", 280000, 180000, "GC-SUPER"),
      ],
    },
    {
      id: "proj_okonkwo",
      leadId: "lead_okonkwo",
      contactId: "c_okonkwo",
      name: "Okonkwo primary bath",
      status: "active",
      address: "901 Mandana Blvd, Oakland, CA",
      token: "demo_portal_okonkwo",
      client: "Amara Okonkwo",
      startDays: 24,
      rows: [
        priced("Bath demolition", 320000, 210000, "DEMO-GUT"),
        priced("Shower tile", 1480000, 980000, "TILE-SHOWER"),
        priced("Vanity and top", 620000, 410000, "BATH-VANITY"),
        priced("Plumbing", 740000, 520000, "PLB-SHOWER"),
        priced("Shower glass", 460000, 320000, "BATH-GLASS"),
        priced("Paint and supervision", 580000, 300000, "GC-SUPER"),
      ],
    },
    {
      id: "proj_brooks",
      leadId: "lead_brooks",
      contactId: "c_brooks",
      name: "Brooks family room addition",
      status: "active",
      address: "44 Canyon Rd, Orinda, CA",
      token: "demo_portal_brooks",
      client: "Chris Brooks",
      startDays: 40,
      rows: [
        priced("Demo and foundation patch", 840000, 620000, "DEMO-GUT"),
        priced("Framing", 2860000, 2100000, "FRM-WALL"),
        priced("Windows and doors", 1220000, 900000, "WIN-REPL"),
        priced("Roof tie-in", 980000, 720000, "ROOF-ARCH"),
        priced("Electrical and HVAC", 1140000, 860000, "ELE-KIT"),
        priced("Drywall and paint", 820000, 560000, "DW-HANG"),
        priced("Supervision", 740000, 440000, "GC-SUPER"),
      ],
    },
    {
      id: "proj_diaz",
      leadId: "lead_diaz",
      contactId: "c_diaz",
      name: "Diaz deck replacement",
      status: "complete",
      address: "602 Santa Clara Ave, Alameda, CA",
      token: "demo_portal_diaz",
      client: "Rosa Diaz",
      startDays: 70,
      rows: [
        priced("Remove the old deck", 220000, 140000, "DEMO-SELECT"),
        priced("Composite boards", 960000, 680000, "DECK-BOARD"),
        priced("Railing", 640000, 430000, "DECK-RAIL"),
        priced("Footings and stairs", 380000, 260000, "DECK-FOOT"),
        priced("Supervision", 200000, 140000, "GC-SUPER"),
      ],
    },
  ];

  for (const job of historical) {
    const snap = pack({ title: job.name, clientName: job.client, address: job.address, rows: job.rows });
    const total = snap.public.totalCents;
    if (total !== job.rows.reduce((sum, row) => sum + row.priceCents, 0)) {
      throw new Error(`Snapshot total mismatch for ${job.id}`);
    }
    const proposalId = `prop_${job.id}`;
    db.insert(proposals)
      .values({
        id: proposalId,
        orgId: ORG,
        estimateId: "est_briggs",
        leadId: job.leadId,
        projectId: null,
        status: "signed",
        publicToken: `demo_proposal_${job.id.replace("proj_", "")}`,
        snapshotJson: JSON.stringify(snap),
        paymentScheduleJson: JSON.stringify(snap.public.schedule),
        termsVersion: "2026-09-01",
        totalCents: total,
        sentAt: daysAgo(job.startDays + 5),
        viewedAt: daysAgo(job.startDays + 4),
        signedAt: daysAgo(job.startDays + 3),
        declinedAt: null,
        expiresAt: daysFromNow(10),
        createdAt: daysAgo(job.startDays + 5),
        updatedAt: daysAgo(job.startDays + 3),
        createdBy: "user_maya",
      })
      .run();
    db.insert(signatures)
      .values({
        id: `sig_${job.id}`,
        orgId: ORG,
        proposalId,
        changeOrderId: null,
        signerName: job.client,
        signerEmail: null,
        typedName: job.client,
        drawnDataUrl: null,
        signedAt: daysAgo(job.startDays + 3),
        ip: "203.0.113.10",
        userAgent: "seed",
        docHash: sha256(canonicalJson(snap.public)),
        consentTextVersion: "2026-09-01",
        consentAccepted: 1,
      })
      .run();
    db.insert(projects)
      .values({
        id: job.id,
        orgId: ORG,
        leadId: job.leadId,
        proposalId,
        contactId: job.contactId,
        name: job.name,
        status: job.status,
        address: job.address,
        contractValueCents: total,
        originalContractCents: total,
        startDate: daysAgo(job.startDays).slice(0, 10),
        endDate: job.status === "complete" ? daysAgo(12).slice(0, 10) : null,
        portalToken: job.token,
        createdAt: daysAgo(job.startDays + 3),
        updatedAt: now,
        createdBy: "user_maya",
      })
      .run();
    if (job.id === "proj_diaz") {
      const closedOn = daysAgo(4).slice(0, 10);
      db.update(projects)
        .set({
          substantialAt: daysAgo(6),
          closedAt: daysAgo(4),
          warrantyEndsOn: addMonths(closedOn, 12),
          warrantyMonths: 12,
          updatedAt: now,
        })
        .where(eq(projects.id, job.id))
        .run();
    }
    db.update(proposals).set({ projectId: job.id }).where(eq(proposals.id, proposalId)).run();
    db.insert(budgetLines)
      .values(
        snap.lines.map((line, index) => ({
          id: `bud_${job.id}_${index}`,
          orgId: ORG,
          projectId: job.id,
          changeOrderId: null,
          name: line.name,
          costCode: line.costCode,
          budgetCostCents: line.costCents,
          budgetPriceCents: line.priceCents,
          sourceLineId: null,
          createdAt: daysAgo(job.startDays + 3),
        })),
      )
      .run();
    jobs.push({
      id: job.id,
      leadId: job.leadId,
      proposalId,
      contactId: job.contactId,
      name: job.name,
      status: job.status,
      address: job.address,
      token: job.token,
      start: daysAgo(job.startDays),
      snap,
      client: job.client,
    });
  }

  // Historical proposals point at est_briggs only to satisfy a non-null estimate id.
  // They are frozen snapshots; the live estimate editor uses est_briggs for the Briggs lead.

  db.insert(changeOrders)
    .values([
      {
        id: "co_ok_1",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 1,
        title: "Recessed niche in the shower",
        status: "approved",
        description: "Add a tiled niche on the wet wall.",
        priceDeltaCents: 180000,
        costDeltaCents: 110000,
        publicToken: "demo_co_okonkwo_1",
        sentAt: daysAgo(12),
        approvedAt: daysAgo(11),
        createdAt: daysAgo(12),
        updatedAt: daysAgo(11),
        createdBy: "user_luis",
      },
      {
        id: "co_ok_2",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 2,
        title: "Move the vanity supply",
        status: "approved",
        description: "Shift the vanity two feet and extend the supply and drain.",
        priceDeltaCents: 240000,
        costDeltaCents: 150000,
        publicToken: "demo_co_okonkwo_2",
        sentAt: daysAgo(8),
        approvedAt: daysAgo(7),
        createdAt: daysAgo(8),
        updatedAt: daysAgo(7),
        createdBy: "user_luis",
      },
      {
        id: "co_ok_3",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 3,
        title: "Heated floor mat",
        status: "sent",
        description: "Mat under the vanity tile.",
        priceDeltaCents: 96000,
        costDeltaCents: 64000,
        publicToken: "demo_co_okonkwo_3",
        sentAt: daysAgo(2),
        approvedAt: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
        createdBy: "user_luis",
      },
    ])
    .run();
  db.insert(changeOrderLines)
    .values([
      {
        id: "col_ok_1",
        orgId: ORG,
        changeOrderId: "co_ok_1",
        name: "Shower niche, tiled",
        qtyMilli: 1000,
        unit: "ea",
        unitCostCents: 110000,
        markupBps: 3500,
        priceCents: 180000,
        costCode: "TILE-NICHE",
        sortOrder: 0,
      },
      {
        id: "col_ok_2",
        orgId: ORG,
        changeOrderId: "co_ok_2",
        name: "Relocate vanity supply and drain",
        qtyMilli: 1000,
        unit: "ea",
        unitCostCents: 150000,
        markupBps: 3500,
        priceCents: 240000,
        costCode: "PLB-VANITY",
        sortOrder: 0,
      },
      {
        id: "col_ok_3",
        orgId: ORG,
        changeOrderId: "co_ok_3",
        name: "Heated floor mat",
        qtyMilli: 1000,
        unit: "ea",
        unitCostCents: 64000,
        markupBps: 3500,
        priceCents: 96000,
        costCode: "TILE-HEAT",
        sortOrder: 0,
      },
    ])
    .run();
  db.insert(budgetLines)
    .values([
      {
        id: "bud_co_1",
        orgId: ORG,
        projectId: "proj_okonkwo",
        changeOrderId: "co_ok_1",
        name: "Shower niche, tiled",
        costCode: "TILE-NICHE",
        budgetCostCents: 110000,
        budgetPriceCents: 180000,
        sourceLineId: null,
        createdAt: daysAgo(11),
      },
      {
        id: "bud_co_2",
        orgId: ORG,
        projectId: "proj_okonkwo",
        changeOrderId: "co_ok_2",
        name: "Relocate vanity supply and drain",
        costCode: "PLB-VANITY",
        budgetCostCents: 150000,
        budgetPriceCents: 240000,
        sourceLineId: null,
        createdAt: daysAgo(7),
      },
    ])
    .run();

  db.insert(budgetLines)
    .values({
      id: "bud_ok_floor",
      orgId: ORG,
      projectId: "proj_okonkwo",
      changeOrderId: null,
      name: "Floor tile allowance",
      costCode: "TILE-FLR",
      budgetCostCents: 120000,
      budgetPriceCents: 180000,
      sourceLineId: null,
      createdAt: daysAgo(20),
    })
    .run();

  const okonkwo = jobs.find((job) => job.id === "proj_okonkwo")!;
  db.update(projects)
    .set({ contractValueCents: okonkwo.snap.public.totalCents + 180000 + 240000, updatedAt: now })
    .where(eq(projects.id, "proj_okonkwo"))
    .run();

  type InvoiceSeed = {
    id: string;
    projectId: string;
    number: string;
    type: string;
    status: string;
    index: number | null;
    total: number;
    paid: number;
    token: string;
    days: number;
    co?: string;
    description: string;
  };

  const invoiceSeeds: InvoiceSeed[] = [
    { id: "inv_chen_dep", projectId: "proj_chen", number: "RR-1041", type: "deposit", status: "open", index: 0, total: 736000, paid: 0, token: "demo_pay_chen_deposit", days: 5, description: "Deposit to schedule the powder room" },
    { id: "inv_ok_dep", projectId: "proj_okonkwo", number: "RR-1033", type: "deposit", status: "paid", index: 0, total: 1680000, paid: 1680000, token: "demo_pay_okonkwo_deposit", days: 26, description: "Deposit to schedule the bath" },
    { id: "inv_ok_prog", projectId: "proj_okonkwo", number: "RR-1038", type: "progress", status: "open", index: 1, total: 1680000, paid: 0, token: "demo_pay_okonkwo_progress", days: 6, description: "Progress at rough-in" },
    { id: "inv_br_dep", projectId: "proj_brooks", number: "RR-1022", type: "deposit", status: "paid", index: 0, total: 3440000, paid: 3440000, token: "demo_pay_brooks_deposit", days: 42, description: "Deposit to schedule the addition" },
    { id: "inv_br_prog", projectId: "proj_brooks", number: "RR-1036", type: "progress", status: "open", index: 1, total: 3440000, paid: 0, token: "demo_pay_brooks_progress", days: 9, description: "Progress at framing" },
    { id: "inv_dz_dep", projectId: "proj_diaz", number: "RR-1008", type: "deposit", status: "paid", index: 0, total: 960000, paid: 960000, token: "demo_pay_diaz_deposit", days: 72, description: "Deposit to schedule the deck" },
    { id: "inv_dz_prog", projectId: "proj_diaz", number: "RR-1014", type: "progress", status: "paid", index: 1, total: 960000, paid: 960000, token: "demo_pay_diaz_progress", days: 40, description: "Progress at framing" },
    { id: "inv_dz_final", projectId: "proj_diaz", number: "RR-1019", type: "final", status: "open", index: 2, total: 480000, paid: 0, token: "demo_pay_diaz_final", days: 10, description: "Final on completion" },
  ];

  db.insert(invoices)
    .values(
      invoiceSeeds.map((invoice) => ({
        id: invoice.id,
        orgId: ORG,
        projectId: invoice.projectId,
        changeOrderId: invoice.co ?? null,
        number: invoice.number,
        type: invoice.type,
        status: invoice.status,
        scheduleIndex: invoice.index,
        issueDate: daysAgo(invoice.days).slice(0, 10),
        dueDate: daysAgo(invoice.days - 7).slice(0, 10),
        subtotalCents: invoice.total,
        taxCents: 0,
        totalCents: invoice.total,
        amountPaidCents: invoice.paid,
        payToken: invoice.token,
        createdAt: daysAgo(invoice.days),
        updatedAt: now,
        createdBy: "user_sam",
      })),
    )
    .run();
  db.insert(invoiceLines)
    .values(
      invoiceSeeds.map((invoice, index) => ({
        id: `invl_${index}`,
        orgId: ORG,
        invoiceId: invoice.id,
        description: invoice.description,
        amountCents: invoice.total,
        sortOrder: 0,
      })),
    )
    .run();

  const paid = invoiceSeeds.filter((invoice) => invoice.status === "paid");
  db.insert(payments)
    .values(
      paid.map((invoice) => {
        const fee = achFeeCents(invoice.total);
        return {
          id: `pay_${invoice.id}`,
          orgId: ORG,
          invoiceId: invoice.id,
          method: "ach",
          amountCents: invoice.total,
          feeCents: fee,
          netCents: invoice.total - fee,
          status: "succeeded",
          stripePaymentIntent: `pi_mock_${invoice.id}`,
          idempotencyKey: `seed_${invoice.id}`,
          failureReason: null,
          stub: 1,
          createdAt: daysAgo(invoice.days - 1),
          updatedAt: daysAgo(invoice.days - 1),
        };
      }),
    )
    .run();

  db.insert(costItems)
    .values([
      { id: "cost_ok_tile", orgId: ORG, projectId: "proj_okonkwo", budgetLineId: null, costCode: "TILE-SHOWER", amountCents: 620000, vendorName: "Casa Tile", memo: "Shower wall materials and set, draw 1", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(9), updatedAt: daysAgo(9), createdBy: "user_sam" },
      { id: "cost_ok_time", orgId: ORG, projectId: "proj_okonkwo", budgetLineId: null, costCode: "TILE-SHOWER", amountCents: 39000, vendorName: "Dana Cho", memo: "Labor", source: "labor", aiExtracted: 0, documentId: null, createdAt: daysAgo(1), updatedAt: daysAgo(1), createdBy: "user_maya" },
      { id: "cost_ok_plb", orgId: ORG, projectId: "proj_okonkwo", budgetLineId: null, costCode: "PLB-SHOWER", amountCents: 280000, vendorName: "Harbor Plumbing", memo: "Rough-in", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(8), updatedAt: daysAgo(8), createdBy: "user_sam" },
      { id: "cost_br_lumber", orgId: ORG, projectId: "proj_brooks", budgetLineId: null, costCode: "FRM-WALL", amountCents: 1842500, vendorName: "Summit Lumber", memo: "Framing package, ticket 4419", source: "receipt", aiExtracted: 1, documentId: "doc_receipt_summit", createdAt: daysAgo(6), updatedAt: daysAgo(6), createdBy: "user_dana" },
      { id: "cost_br_labor", orgId: ORG, projectId: "proj_brooks", budgetLineId: null, costCode: "FRM-LABOR", amountCents: 3200000, vendorName: "Rivera crew", memo: "Carpenter hours through last Friday", source: "labor", aiExtracted: 0, documentId: null, createdAt: daysAgo(4), updatedAt: daysAgo(4), createdBy: "user_sam" },
      { id: "cost_br_subs", orgId: ORG, projectId: "proj_brooks", budgetLineId: null, costCode: "ROOF-ARCH", amountCents: 2357500, vendorName: "Ridgeline Roofing", memo: "Tie-in and dry-in", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(3), updatedAt: daysAgo(3), createdBy: "user_sam" },
      { id: "cost_dz_1", orgId: ORG, projectId: "proj_diaz", budgetLineId: null, costCode: "DECK-BOARD", amountCents: 980000, vendorName: "Summit Lumber", memo: "Boards and hardware", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(30), updatedAt: daysAgo(30), createdBy: "user_sam" },
      { id: "cost_dz_2", orgId: ORG, projectId: "proj_diaz", budgetLineId: null, costCode: "FRM-LABOR", amountCents: 670000, vendorName: "Rivera crew", memo: "Deck labor", source: "labor", aiExtracted: 0, documentId: null, createdAt: daysAgo(20), updatedAt: daysAgo(20), createdBy: "user_sam" },
      { id: "cost_bill_hp", orgId: ORG, projectId: "proj_okonkwo", budgetLineId: null, costCode: "PLB-SHOWER", amountCents: 150000, vendorName: "Harbor Plumbing", memo: "Bill HP-441", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(4), updatedAt: daysAgo(4), createdBy: "user_sam" },
      { id: "cost_bill_sl", orgId: ORG, projectId: "proj_diaz", budgetLineId: null, costCode: "DECK-BOARD", amountCents: 125000, vendorName: "Summit Lumber", memo: "Bill SL-1904", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(12), updatedAt: daysAgo(8), createdBy: "user_sam" },
      { id: "cost_bill_be", orgId: ORG, projectId: "proj_brooks", budgetLineId: null, costCode: "ELE-KIT", amountCents: 700000, vendorName: "Brighton Electric", memo: "Bill BE-77", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(10), updatedAt: daysAgo(10), createdBy: "user_sam" },
    ])
    .run();

  const billToday = localDay(Date.now(), "America/New_York");
  const billDueSoon = addCalendarDays(billToday, 3);
  const billDueLater = addCalendarDays(billToday, 12);
  const billOverdue = addCalendarDays(billToday, -1);
  db.insert(bills)
    .values([
      {
        id: "bill_ok_draft",
        orgId: ORG,
        projectId: "proj_okonkwo",
        vendorContactId: "c_casa",
        billNumber: "CT-2208",
        billDate: addCalendarDays(billToday, -2),
        amountCents: 42000,
        dueDate: billDueLater,
        status: "draft",
        memo: "Niche tile, not approved yet",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: null,
        approvedAt: null,
        lowConfidence: 0,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_sam",
      },
      {
        id: "bill_ok_harbor",
        orgId: ORG,
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        billNumber: "HP-441",
        billDate: addCalendarDays(billToday, -5),
        amountCents: 150000,
        dueDate: billDueSoon,
        status: "approved",
        memo: "Valve and trim",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: "po_ok_harbor",
        approvedAt: daysAgo(4),
        lowConfidence: 0,
        createdAt: daysAgo(5),
        updatedAt: daysAgo(4),
        createdBy: "user_sam",
      },
      {
        id: "bill_dz_summit",
        orgId: ORG,
        projectId: "proj_diaz",
        vendorContactId: "c_summit",
        billNumber: "SL-1904",
        billDate: addCalendarDays(billToday, -20),
        amountCents: 125000,
        dueDate: addCalendarDays(billToday, -10),
        status: "paid",
        memo: "Extra boards",
        voidReason: null,
        paidAt: addCalendarDays(billToday, -8),
        payMethod: "check",
        payReference: "4412",
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(18),
        lowConfidence: 0,
        createdAt: daysAgo(20),
        updatedAt: daysAgo(8),
        createdBy: "user_sam",
      },
      {
        id: "bill_br_brighton",
        orgId: ORG,
        projectId: "proj_brooks",
        vendorContactId: "c_brighton",
        billNumber: "BE-77",
        billDate: addCalendarDays(billToday, -14),
        amountCents: 700000,
        dueDate: billOverdue,
        status: "approved",
        memo: "Rough electrical",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(10),
        lowConfidence: 0,
        createdAt: daysAgo(14),
        updatedAt: daysAgo(10),
        createdBy: "user_sam",
      },
    ])
    .run();
  db.insert(billLines)
    .values([
      { id: "bln_ok_draft", orgId: ORG, billId: "bill_ok_draft", costCode: "TILE-SHOWER", description: "Niche tile", amountCents: 42000, costItemId: null, sortOrder: 0 },
      { id: "bln_ok_harbor", orgId: ORG, billId: "bill_ok_harbor", costCode: "PLB-SHOWER", description: "Valve and trim", amountCents: 150000, costItemId: "cost_bill_hp", sortOrder: 0 },
      { id: "bln_dz_summit", orgId: ORG, billId: "bill_dz_summit", costCode: "DECK-BOARD", description: "Extra boards", amountCents: 125000, costItemId: "cost_bill_sl", sortOrder: 0 },
      { id: "bln_br_brighton", orgId: ORG, billId: "bill_br_brighton", costCode: "ELE-KIT", description: "Rough electrical", amountCents: 700000, costItemId: "cost_bill_be", sortOrder: 0 },
    ])
    .run();
  db.insert(billEvents)
    .values([
      { id: "bev_ok_draft", orgId: ORG, billId: "bill_ok_draft", actorId: "user_sam", type: "created", reason: null, beforeJson: null, afterJson: null, createdAt: daysAgo(1) },
      { id: "bev_ok_harbor", orgId: ORG, billId: "bill_ok_harbor", actorId: "user_sam", type: "approved", reason: null, beforeJson: null, afterJson: JSON.stringify({ status: "approved", costItemIds: ["cost_bill_hp"] }), createdAt: daysAgo(4) },
      { id: "bev_dz_summit", orgId: ORG, billId: "bill_dz_summit", actorId: "user_sam", type: "paid", reason: null, beforeJson: null, afterJson: JSON.stringify({ status: "paid", method: "check", reference: "4412" }), createdAt: daysAgo(8) },
      { id: "bev_br_brighton", orgId: ORG, billId: "bill_br_brighton", actorId: "user_sam", type: "approved", reason: null, beforeJson: null, afterJson: JSON.stringify({ status: "approved", costItemIds: ["cost_bill_be"] }), createdAt: daysAgo(10) },
    ])
    .run();

  db.insert(purchaseOrders)
    .values({
      id: "po_ok_harbor",
      orgId: ORG,
      projectId: "proj_okonkwo",
      vendorContactId: "c_harbor",
      changeOrderId: null,
      number: "PO-1044",
      scope: "Shower valve, trim, and the rest of the plumbing package.",
      status: "issued",
      voidReason: null,
      issuedAt: daysAgo(6),
      closedAt: null,
      createdAt: daysAgo(7),
      updatedAt: daysAgo(6),
      createdBy: "user_sam",
    })
    .run();
  db.insert(purchaseOrderLines)
    .values({
      id: "pol_ok_harbor",
      orgId: ORG,
      purchaseOrderId: "po_ok_harbor",
      costCode: "PLB-SHOWER",
      description: "Valve, trim, and remaining rough",
      amountCents: 400000,
      sortOrder: 0,
    })
    .run();
  db.insert(purchaseOrderEvents)
    .values([
      { id: "poe_ok_created", orgId: ORG, purchaseOrderId: "po_ok_harbor", actorId: "user_sam", type: "created", reason: null, beforeJson: null, afterJson: null, createdAt: daysAgo(7) },
      { id: "poe_ok_issued", orgId: ORG, purchaseOrderId: "po_ok_harbor", actorId: "user_sam", type: "issued", reason: null, beforeJson: null, afterJson: JSON.stringify({ status: "issued" }), createdAt: daysAgo(6) },
    ])
    .run();

  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const riveraZone = "America/New_York";
  const today = localDay(Date.now(), riveraZone);
  const yesterday = addCalendarDays(today, -1);
  const weekStart = localWeek(Date.now(), { timeZone: riveraZone, weekStartsOn: 1 }).startDay;
  const riveraAt = (day: string, hour: number) => {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(zonedTimeToUtc(year, month, date, hour, 0, 0, riveraZone)).toISOString();
  };
  const luisIn = riveraAt(weekStart, 7);
  const approvedIn = hoursAgo(30);
  const approvedOut = hoursAgo(22);
  db.insert(laborRates)
    .values([
      { id: "rate_rivera", orgId: ORG, userId: "", hourlyCostCents: 4500, updatedAt: created, updatedBy: "user_maya" },
      { id: "rate_dana", orgId: ORG, userId: "user_dana", hourlyCostCents: 5200, updatedAt: created, updatedBy: "user_maya" },
      { id: "rate_north", orgId: NORTH, userId: "", hourlyCostCents: 4800, updatedAt: created, updatedBy: "user_jordan" },
    ])
    .run();
  db.insert(timeEntries)
    .values([
      {
        id: "time_ok_tile",
        orgId: ORG,
        userId: "user_dana",
        projectId: "proj_okonkwo",
        costCode: "TILE-SHOWER",
        status: "approved",
        clockInAt: approvedIn,
        clockOutAt: approvedOut,
        breakMinutes: 30,
        breakStartedAt: null,
        note: "Set the shower wall",
        clockInLatE6: 37799400,
        clockInLngE6: -122247000,
        clockOutLatE6: 37799400,
        clockOutLngE6: -122247000,
        source: "clock",
        createdAt: approvedIn,
        updatedAt: approvedOut,
        createdBy: "user_dana",
      },
      {
        id: "time_ok_open",
        orgId: ORG,
        userId: "user_dana",
        projectId: "proj_okonkwo",
        costCode: "GC-SUPER",
        status: "open",
        clockInAt: hoursAgo(17),
        clockOutAt: null,
        breakMinutes: 0,
        breakStartedAt: null,
        note: null,
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "clock",
        createdAt: hoursAgo(17),
        updatedAt: hoursAgo(17),
        createdBy: "user_dana",
      },
      {
        id: "time_ok_overlap",
        orgId: ORG,
        userId: "user_dana",
        projectId: "proj_okonkwo",
        costCode: "PLB-SHOWER",
        status: "pending",
        clockInAt: hoursAgo(12),
        clockOutAt: hoursAgo(11),
        breakMinutes: 0,
        breakStartedAt: null,
        note: "Ran to the supplier",
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "clock",
        createdAt: hoursAgo(12),
        updatedAt: hoursAgo(11),
        createdBy: "user_dana",
      },
      {
        id: "time_chen_yday",
        orgId: ORG,
        userId: "user_sam",
        projectId: "proj_chen",
        costCode: "GC-SUPER",
        status: "pending",
        clockInAt: riveraAt(yesterday, 10),
        clockOutAt: riveraAt(yesterday, 12),
        breakMinutes: 0,
        breakStartedAt: null,
        note: "Walked the powder room",
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "manual",
        createdAt: daysAgo(3),
        updatedAt: daysAgo(3),
        createdBy: "user_maya",
      },
      {
        id: "time_dana_gap_a",
        orgId: ORG,
        userId: "user_dana",
        projectId: "proj_okonkwo",
        costCode: "TILE-SHOWER",
        status: "pending",
        clockInAt: hoursAgo(21.5),
        clockOutAt: hoursAgo(19.5),
        breakMinutes: 0,
        breakStartedAt: null,
        note: "Set the curb",
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "clock",
        createdAt: hoursAgo(21.5),
        updatedAt: hoursAgo(19.5),
        createdBy: "user_dana",
      },
      {
        id: "time_luis_week",
        orgId: ORG,
        userId: "user_luis",
        projectId: "proj_brooks",
        costCode: "FRM-LABOR",
        status: "approved",
        clockInAt: luisIn,
        clockOutAt: new Date(Date.parse(luisIn) + 44 * 3_600_000).toISOString(),
        breakMinutes: 0,
        breakStartedAt: null,
        note: "Framed through midweek",
        clockInLatE6: null,
        clockInLngE6: null,
        clockOutLatE6: null,
        clockOutLngE6: null,
        source: "manual",
        createdAt: luisIn,
        updatedAt: luisIn,
        createdBy: "user_maya",
      },
    ])
    .run();
  db.insert(timeApprovals)
    .values({
      id: "tap_ok_tile",
      orgId: ORG,
      entryId: "time_ok_tile",
      rateCents: 5200,
      minutes: 450,
      amountCents: 39000,
      costItemId: "cost_ok_time",
      status: "active",
      reason: null,
      createdAt: approvedOut,
      createdBy: "user_maya",
    })
    .run();
  db.insert(timeEntryEvents)
    .values([
      {
        id: "tev_ok_tile",
        orgId: ORG,
        entryId: "time_ok_tile",
        actorId: "user_maya",
        type: "approved",
        reason: null,
        beforeJson: JSON.stringify({ status: "pending" }),
        afterJson: JSON.stringify({ status: "approved" }),
        createdAt: approvedOut,
      },
      {
        id: "tev_ok_open",
        orgId: ORG,
        entryId: "time_ok_open",
        actorId: "user_dana",
        type: "created",
        reason: null,
        beforeJson: null,
        afterJson: JSON.stringify({ status: "open", costCode: "GC-SUPER" }),
        createdAt: hoursAgo(17),
      },
    ])
    .run();

  db.insert(dailyLogs)
    .values([
      {
        id: "log_ok_yday",
        orgId: ORG,
        projectId: "proj_okonkwo",
        authorId: "user_dana",
        logDate: yesterday,
        status: "published",
        visibility: "client",
        notes: "Set the shower wall and kept the niche dry.",
        plannedNext: "Grout the curb.",
        weatherSky: "Clear",
        weatherHighF: 72,
        weatherLowF: 54,
        weatherLostMinutes: 0,
        weatherImpact: "No weather delay.",
        delayCause: "Waited on the inspector for two hours.",
        delayMinutes: 120,
        deliveries: "Niche tile from Casa Tile.",
        visitors: "City inspector, rough-in.",
        safetyNote: "Wet floor at the curb.",
        publishedAt: daysAgo(1),
        voidReason: null,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      },
      {
        id: "log_br_yday",
        orgId: ORG,
        projectId: "proj_brooks",
        authorId: "user_sam",
        logDate: yesterday,
        status: "published",
        visibility: "internal",
        notes: "Framed the west wall before the rain.",
        plannedNext: "Shear the corners.",
        weatherSky: "Rain",
        weatherHighF: 61,
        weatherLowF: 52,
        weatherLostMinutes: 90,
        weatherImpact: "Stopped the sheathing early.",
        delayCause: null,
        delayMinutes: null,
        deliveries: null,
        visitors: null,
        safetyNote: "Slippery scaffold boards.",
        publishedAt: daysAgo(1),
        voidReason: null,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      },
      {
        id: "log_ok_draft",
        orgId: ORG,
        projectId: "proj_okonkwo",
        authorId: "user_dana",
        logDate: today,
        status: "draft",
        visibility: "internal",
        notes: null,
        plannedNext: null,
        weatherSky: null,
        weatherHighF: null,
        weatherLowF: null,
        weatherLostMinutes: null,
        weatherImpact: null,
        delayCause: null,
        delayMinutes: null,
        deliveries: null,
        visitors: null,
        safetyNote: null,
        publishedAt: null,
        voidReason: null,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  db.insert(dailyLogEvents)
    .values([
      {
        id: "dlev_ok_yday",
        orgId: ORG,
        logId: "log_ok_yday",
        actorId: "user_maya",
        type: "published",
        reason: null,
        beforeJson: JSON.stringify({ status: "draft", visibility: "internal" }),
        afterJson: JSON.stringify({ status: "published", visibility: "client", notes: "Set the shower wall and kept the niche dry." }),
        createdAt: daysAgo(1),
      },
      {
        id: "dlev_br_yday",
        orgId: ORG,
        logId: "log_br_yday",
        actorId: "user_sam",
        type: "published",
        reason: null,
        beforeJson: JSON.stringify({ status: "draft" }),
        afterJson: JSON.stringify({ status: "published", visibility: "internal" }),
        createdAt: daysAgo(1),
      },
    ])
    .run();

  const photo = (id: string, leadId: string | null, projectId: string | null, file: string, caption: string) => ({
    id,
    orgId: ORG,
    projectId,
    leadId,
    contactId: null,
    type: "photo",
    filename: file,
    storagePath: `/demo/${file}`,
    metadataJson: JSON.stringify({ caption }),
    deletedAt: null,
    createdAt: daysAgo(2),
    createdBy: "user_dana",
  });

  db.insert(documents)
    .values([
      photo("doc_v1", "lead_vasquez", null, "photos/vasquez-cabinets.svg", "Existing oak cabinets"),
      photo("doc_v2", "lead_vasquez", null, "photos/vasquez-floor.svg", "Sheet vinyl to come out"),
      photo("doc_v3", "lead_vasquez", null, "photos/vasquez-sink.svg", "Sink on the plumbing wall"),
      photo("doc_o1", null, "proj_okonkwo", "photos/okonkwo-shower.svg", "Shower substrate"),
      photo("doc_o2", null, "proj_okonkwo", "photos/okonkwo-vanity.svg", "Vanity location"),
      photo("doc_b1", null, "proj_brooks", "photos/brooks-framing.svg", "Addition framing"),
      photo("doc_b2", null, "proj_brooks", "photos/brooks-roof.svg", "Roof tie-in"),
      photo("doc_c1", null, "proj_chen", "photos/chen-powder.svg", "Powder room before"),
      photo("doc_d1", null, "proj_diaz", "photos/diaz-deck.svg", "New deck boards"),
      photo("doc_d2", null, "proj_diaz", "photos/diaz-rail.svg", "Railing detail"),
      {
        id: "doc_receipt_summit",
        orgId: ORG,
        projectId: "proj_brooks",
        leadId: null,
        contactId: "c_summit",
        type: "receipt",
        filename: "receipts/summit-lumber.svg",
        storagePath: "/demo/receipts/summit-lumber.svg",
        metadataJson: JSON.stringify({ vendor: "Summit Lumber", amountCents: 1842500 }),
        deletedAt: null,
        createdAt: daysAgo(6),
        createdBy: "user_dana",
      },
      {
        id: "doc_receipt_casa",
        orgId: ORG,
        projectId: "proj_okonkwo",
        leadId: null,
        contactId: "c_casa",
        type: "receipt",
        filename: "receipts/casa-tile.svg",
        storagePath: "/demo/receipts/casa-tile.svg",
        metadataJson: JSON.stringify({ vendor: "Casa Tile", amountCents: 86450, posted: false }),
        deletedAt: null,
        createdAt: daysAgo(1),
        createdBy: "user_dana",
      },
      {
        id: "doc_receipt_harbor",
        orgId: ORG,
        projectId: "proj_chen",
        leadId: null,
        contactId: "c_harbor",
        type: "receipt",
        filename: "receipts/harbor-plumbing.svg",
        storagePath: "/demo/receipts/harbor-plumbing.svg",
        metadataJson: JSON.stringify({ vendor: "Harbor Plumbing", amountCents: 42600, posted: false }),
        deletedAt: null,
        createdAt: daysAgo(1),
        createdBy: "user_sam",
      },
    ])
    .run();
  db.insert(dailyLogPhotos)
    .values({
      id: "dlp_ok_yday",
      orgId: ORG,
      logId: "log_ok_yday",
      documentId: "doc_o1",
      createdAt: daysAgo(1),
    })
    .run();

  db.insert(tasks)
    .values([
      { id: "task_vasquez", orgId: ORG, title: "Confirm quartz edge with Elena before the estimate goes out", assigneeUserId: "user_luis", dueAt: daysFromNow(1), relatedType: "lead", relatedId: "lead_vasquez", status: "open", createdAt: now, updatedAt: now, createdBy: "user_maya" },
      { id: "task_ok", orgId: ORG, title: "Order the niche tile for Okonkwo", assigneeUserId: "user_dana", dueAt: daysFromNow(2), relatedType: "project", relatedId: "proj_okonkwo", status: "open", createdAt: daysAgo(1), updatedAt: daysAgo(1), createdBy: "user_luis" },
      { id: "task_diaz", orgId: ORG, title: "Collect the Diaz final invoice", assigneeUserId: "user_sam", dueAt: daysAgo(1), relatedType: "project", relatedId: "proj_diaz", status: "open", createdAt: daysAgo(5), updatedAt: daysAgo(5), createdBy: "user_maya" },
    ])
    .run();

  db.insert(messageThreads)
    .values([
      { id: "thread_briggs", orgId: ORG, contactId: "c_briggs", leadId: "lead_briggs", projectId: null, subject: "Briggs deck stain proposal", createdAt: daysAgo(4), updatedAt: daysAgo(3) },
      { id: "thread_vasquez", orgId: ORG, contactId: "c_vasquez", leadId: "lead_vasquez", projectId: null, subject: "Kitchen inquiry", createdAt: daysAgo(9), updatedAt: daysAgo(9) },
    ])
    .run();
  db.insert(messages)
    .values([
      { id: "msg_vasquez", orgId: ORG, threadId: "thread_vasquez", channel: "email", direction: "in", body: vasquezScope, status: "received", consentOk: 1, createdAt: daysAgo(9), createdBy: null },
      { id: "msg_briggs", orgId: ORG, threadId: "thread_briggs", channel: "email", direction: "out", body: "Tom, the deck stain proposal is ready. The link is in this thread. Deposit holds the week of the 20th.", status: "sent_stub", consentOk: 1, createdAt: daysAgo(4), createdBy: "user_luis" },
    ])
    .run();

  const nudge = proposalNudgeCopy({
    firstName: "Tom",
    jobTitle: "Briggs deck stain",
    company: "Maya Rivera, Rivera Remodeling & Trade",
    days: 3,
    opened: true,
  });
  db.insert(followUpDrafts)
    .values({
      id: "draft_briggs",
      orgId: ORG,
      contactId: "c_briggs",
      leadId: "lead_briggs",
      proposalId: "prop_briggs",
      kind: "proposal_unsigned",
      status: "pending",
      subject: nudge.subject,
      body: nudge.body,
      createdAt: daysAgo(0),
      updatedAt: now,
    })
    .run();

  const activity = (
    id: string,
    entityType: string,
    entityId: string,
    type: string,
    summary: string,
    when: string,
    actorType = "user",
    actorId: string | null = "user_maya",
  ) => ({
    id,
    orgId: ORG,
    entityType,
    entityId,
    type,
    actorType,
    actorId,
    summary,
    payloadJson: null,
    createdAt: when,
  });

  const tomorrow = addCalendarDays(today, 1);
  const scheduleDay = (offset: number) => addCalendarDays(weekStart, offset);
  const scheduleSeed: {
    id: string;
    projectId: string;
    title: string;
    start: string;
    end: string;
    time: string | null;
    status: string;
    note: string | null;
    assignees: string[];
    vendorContactId?: string | null;
  }[] = [
    { id: "sch_ok_tile", projectId: "proj_okonkwo", title: "Tile shower", start: today, end: tomorrow, time: "07:30", status: "confirmed", note: "Homeowner home after 3", assignees: ["user_dana"] },
    { id: "sch_ok_plumb", projectId: "proj_okonkwo", title: "Set the valve", start: today, end: today, time: "09:00", status: "confirmed", note: null, assignees: [], vendorContactId: "c_harbor" },
    { id: "sch_chen_conflict", projectId: "proj_chen", title: "Vanity set", start: today, end: today, time: null, status: "planned", note: null, assignees: ["user_dana"] },
    { id: "sch_br_frame", projectId: "proj_brooks", title: "Framing walk", start: scheduleDay(0), end: scheduleDay(1), time: "08:00", status: "confirmed", note: null, assignees: ["user_luis"] },
    { id: "sch_ok_walk", projectId: "proj_okonkwo", title: "Client walk", start: scheduleDay(4), end: scheduleDay(4), time: null, status: "planned", note: null, assignees: ["user_maya"] },
    { id: "sch_dz_punch", projectId: "proj_diaz", title: "Punch list", start: scheduleDay(2), end: scheduleDay(2), time: null, status: "done", note: null, assignees: [] },
    { id: "sch_chen_measure", projectId: "proj_chen", title: "Measure", start: scheduleDay(8), end: scheduleDay(8), time: "09:00", status: "planned", note: null, assignees: ["user_sam"] },
    { id: "sch_br_delivery", projectId: "proj_brooks", title: "Window delivery", start: scheduleDay(10), end: scheduleDay(10), time: null, status: "confirmed", note: null, assignees: ["user_dana"] },
  ];
  db.insert(scheduleItems)
    .values(
      scheduleSeed.map((item) => ({
        id: item.id,
        orgId: ORG,
        projectId: item.projectId,
        title: item.title,
        startDate: item.start,
        endDate: item.end,
        startTime: item.time,
        status: item.status,
        note: item.note,
        vendorContactId: item.vendorContactId ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: "user_maya",
      })),
    )
    .run();
  db.insert(scheduleAssignees)
    .values(
      scheduleSeed.flatMap((item) =>
        item.assignees.map((userId, index) => ({
          id: `scha_${item.id}_${index}`,
          orgId: ORG,
          itemId: item.id,
          userId,
        })),
      ),
    )
    .run();

  const floorDue = addCalendarDays(today, -1);
  const vanitySnap = publicSnapshot({
    selectionId: "sel_ok_vanity",
    title: "Vanity",
    qtyMilli: 1000,
    allowancePriceCents: 620000,
    choice: { id: "choc_ok_quartz", name: "Quartz vanity", priceCents: 620000, differenceCents: 0 },
  });
  db.insert(selections)
    .values([
      {
        id: "sel_ok_floor",
        orgId: ORG,
        projectId: "proj_okonkwo",
        title: "Floor tile",
        area: "Bath",
        dueDate: floorDue,
        status: "released",
        allowanceBudgetLineId: "bud_ok_floor",
        qtyMilli: 1000,
        chosenChoiceId: null,
        costItemId: null,
        changeOrderId: null,
        createdBy: "user_maya",
        createdAt: daysAgo(6),
        updatedAt: daysAgo(2),
      },
      {
        id: "sel_ok_vanity",
        orgId: ORG,
        projectId: "proj_okonkwo",
        title: "Vanity",
        area: "Bath",
        dueDate: addCalendarDays(today, -3),
        status: "chosen",
        allowanceBudgetLineId: "bud_proj_okonkwo_2",
        qtyMilli: 1000,
        chosenChoiceId: "choc_ok_quartz",
        costItemId: "cost_sel_vanity",
        changeOrderId: null,
        createdBy: "user_maya",
        createdAt: daysAgo(12),
        updatedAt: daysAgo(4),
      },
      {
        id: "sel_chen_faucet",
        orgId: ORG,
        projectId: "proj_chen",
        title: "Faucet",
        area: "Powder",
        dueDate: addCalendarDays(today, 21),
        status: "draft",
        allowanceBudgetLineId: null,
        qtyMilli: 1000,
        chosenChoiceId: null,
        costItemId: null,
        changeOrderId: null,
        createdBy: "user_luis",
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      },
    ])
    .run();
  db.insert(selectionChoices)
    .values([
      { id: "choc_ok_linen", orgId: ORG, selectionId: "sel_ok_floor", name: "Linen mosaic", vendor: "Casa Tile", sku: "LINEN-12", link: null, photoDocumentId: null, unitPriceCents: 140000, unitCostCents: 90000, note: null, sortOrder: 0 },
      { id: "choc_ok_porcelain", orgId: ORG, selectionId: "sel_ok_floor", name: "Standard porcelain", vendor: "Casa Tile", sku: "PORC-STD", link: null, photoDocumentId: null, unitPriceCents: 180000, unitCostCents: 120000, note: null, sortOrder: 1 },
      { id: "choc_ok_marble", orgId: ORG, selectionId: "sel_ok_floor", name: "Honed marble", vendor: "Stone Yard", sku: "MARB-HON", link: null, photoDocumentId: "doc_o1", unitPriceCents: 240000, unitCostCents: 165000, note: null, sortOrder: 2 },
      { id: "choc_ok_quartz", orgId: ORG, selectionId: "sel_ok_vanity", name: "Quartz vanity", vendor: "Bathworks", sku: "VAN-QZ", link: null, photoDocumentId: "doc_o2", unitPriceCents: 620000, unitCostCents: 280000, note: null, sortOrder: 0 },
      { id: "choc_ok_maple", orgId: ORG, selectionId: "sel_ok_vanity", name: "Painted maple", vendor: "Bathworks", sku: "VAN-MP", link: null, photoDocumentId: null, unitPriceCents: 480000, unitCostCents: 220000, note: null, sortOrder: 1 },
      { id: "choc_chen_chrome", orgId: ORG, selectionId: "sel_chen_faucet", name: "Chrome faucet", vendor: "Kohler", sku: "FAU-CH", link: null, photoDocumentId: null, unitPriceCents: 18000, unitCostCents: 9000, note: null, sortOrder: 0 },
      { id: "choc_chen_matte", orgId: ORG, selectionId: "sel_chen_faucet", name: "Matte black faucet", vendor: "Kohler", sku: "FAU-MB", link: null, photoDocumentId: null, unitPriceCents: 24000, unitCostCents: 12000, note: null, sortOrder: 1 },
    ])
    .run();
  db.insert(costItems)
    .values({
      id: "cost_sel_vanity",
      orgId: ORG,
      projectId: "proj_okonkwo",
      budgetLineId: "bud_proj_okonkwo_2",
      costCode: "BATH-VANITY",
      amountCents: 280000,
      vendorName: "Bathworks",
      memo: "Quartz vanity",
      source: "selection",
      aiExtracted: 0,
      documentId: null,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      createdBy: "user_maya",
    })
    .run();
  db.insert(selectionEvents)
    .values([
      {
        id: "slev_ok_floor",
        orgId: ORG,
        selectionId: "sel_ok_floor",
        actorId: "user_maya",
        action: "release",
        reason: null,
        beforeJson: JSON.stringify({ status: "draft", chosenChoiceId: null, costItemId: null, changeOrderId: null }),
        afterJson: JSON.stringify({ status: "released", chosenChoiceId: null, costItemId: null, changeOrderId: null }),
        signerName: null,
        ip: null,
        userAgent: null,
        docHash: null,
        consentTextVersion: null,
        createdAt: daysAgo(2),
      },
      {
        id: "slev_ok_vanity",
        orgId: ORG,
        selectionId: "sel_ok_vanity",
        actorId: null,
        action: "choose",
        reason: null,
        beforeJson: JSON.stringify({ status: "released", chosenChoiceId: null, costItemId: null, changeOrderId: null }),
        afterJson: JSON.stringify({ status: "chosen", chosenChoiceId: "choc_ok_quartz", costItemId: "cost_sel_vanity", changeOrderId: null }),
        signerName: "Amara Okonkwo",
        ip: "127.0.0.1",
        userAgent: "seed",
        docHash: sha256(canonicalJson(vanitySnap)),
        consentTextVersion: CONSENT_VERSION,
        createdAt: daysAgo(4),
      },
    ])
    .run();

  db.insert(activities)
    .values([
      activity("act_v1", "lead", "lead_vasquez", "note", "Site visit done. Cabinets are oak, floor is sheet vinyl, sink sits on the plumbing wall.", daysAgo(1), "user", "user_luis"),
      activity("act_v2", "lead", "lead_vasquez", "email", "Elena sent the scope and a budget range of $60–80k.", daysAgo(9), "contact", "c_vasquez"),
      activity("act_b1", "lead", "lead_briggs", "proposal", "Proposal viewed by the client.", daysAgo(3), "system", null),
      activity("act_p1", "lead", "lead_park", "note", "Lost. She took a lower bid that excluded the panel.", daysAgo(18), "user", "user_luis"),
      activity("act_br", "project", "proj_brooks", "alert", "Margin is under the 20% watch line after the lumber ticket posted.", daysAgo(6), "system", null),
      activity("act_ok", "project", "proj_okonkwo", "change_order", "Client approved two change orders.", daysAgo(7), "user", "user_luis"),
      activity("act_web", "lead", "lead_web_ellis", "intake", "Website form from Nora Ellis.", now, "system", null),
    ])
    .run();

  db.insert(aiRuns)
    .values({
      id: "airun_seed",
      orgId: ORG,
      feature: "estimate",
      model: "fieldline-pricebook-v1",
      tokensIn: 0,
      tokensOut: 0,
      costCents: 0,
      inputRef: "lead_briggs",
      outputJson: JSON.stringify({ note: "Seeded historical run. Live estimates log here too." }),
      latencyMs: 12,
      createdAt: daysAgo(5),
      createdBy: "user_luis",
    })
    .run();

  db.insert(integrationConnections)
    .values([
      { id: "int_stripe", orgId: ORG, provider: "stripe", status: "stub", label: "Local test-number mirror until STRIPE_SECRET_KEY is set. Connect is not wired.", createdAt: created, updatedAt: now },
      { id: "int_resend", orgId: ORG, provider: "resend", status: "stub", label: "Email is written to the local outbox until RESEND_API_KEY is set", createdAt: created, updatedAt: now },
      { id: "int_twilio", orgId: ORG, provider: "twilio", status: "not_configured", label: "SMS stays in approval drafts until Twilio and 10DLC are ready", createdAt: created, updatedAt: now },
      { id: "int_qbo", orgId: ORG, provider: "qbo", status: "not_connected", label: "CSV export stands in for QuickBooks until v1.1", createdAt: created, updatedAt: now },
      { id: "int_ai", orgId: ORG, provider: "ai", status: "stub", label: "Estimates use the price book. AI Gateway is used when AI_GATEWAY_API_KEY is set", createdAt: created, updatedAt: now },
    ])
    .run();

  const formFields = JSON.stringify(defaultFields(true));
  db.insert(leadForms)
    .values([
      {
        id: "form_rivera",
        orgId: ORG,
        enabled: 1,
        token: DEMO_RIVERA_FORM_TOKEN,
        intro: "Tell us about the project.",
        thanks: "Thanks. We'll be in touch.",
        fieldsJson: formFields,
        projectTypesJson: JSON.stringify(["Kitchen remodel", "Bath remodel", "Addition", "Deck"]),
        createdAt: created,
        updatedAt: now,
      },
      {
        id: "form_north",
        orgId: NORTH,
        enabled: 0,
        token: DEMO_NORTH_FORM_TOKEN,
        intro: "Tell us about the project.",
        thanks: "Thanks. We'll be in touch.",
        fieldsJson: formFields,
        projectTypesJson: JSON.stringify(["Panel", "EV charger", "Lighting"]),
        createdAt: created,
        updatedAt: now,
      },
    ])
    .run();

  db.insert(leadFormSubmissions)
    .values({
      id: "sub_ellis",
      orgId: ORG,
      formId: "form_rivera",
      leadId: "lead_web_ellis",
      contactId: "c_ellis",
      answersJson: JSON.stringify({
        name: "Nora Ellis",
        email: "nora.ellis@example.com",
        phone: "(510) 555-0194",
        address: "18 Maple St",
        projectType: "Bath remodel",
        budget: "$25–50k",
        timeline: "1–3 months",
        description: "Primary bath, about 80 sq ft, new tile.",
      }),
      attribution: "source website",
      seenAt: null,
      createdAt: now,
    })
    .run();

  const punchToday = localDay(Date.parse(now), "America/New_York");
  db.insert(punchItems)
    .values([
      { id: "punch_ok_curb", orgId: ORG, projectId: "proj_okonkwo", title: "Caulk the curb", location: "Shower", costCode: "TILE-SHOWER", assigneeUserId: "user_dana", assigneeContactId: null, dueDate: punchToday, status: "open", shared: 1, beforeDocumentId: null, afterDocumentId: null, doneAt: null, verifiedAt: null, createdBy: "user_maya", createdAt: daysAgo(2), updatedAt: daysAgo(2) },
      { id: "punch_ok_paint", orgId: ORG, projectId: "proj_okonkwo", title: "Touch up the ceiling", location: "Hall", costCode: "GC-SUPER", assigneeUserId: "user_dana", assigneeContactId: null, dueDate: addCalendarDays(punchToday, -1), status: "done", shared: 0, beforeDocumentId: null, afterDocumentId: null, doneAt: daysAgo(1), verifiedAt: null, createdBy: "user_dana", createdAt: daysAgo(3), updatedAt: daysAgo(1) },
      { id: "punch_ok_vanity", orgId: ORG, projectId: "proj_okonkwo", title: "Align the vanity door", location: "Vanity", costCode: "BATH-VANITY", assigneeUserId: "user_dana", assigneeContactId: null, dueDate: addCalendarDays(punchToday, -3), status: "verified", shared: 1, beforeDocumentId: null, afterDocumentId: null, doneAt: daysAgo(3), verifiedAt: daysAgo(2), createdBy: "user_maya", createdAt: daysAgo(4), updatedAt: daysAgo(2) },
      { id: "punch_ok_esc", orgId: ORG, projectId: "proj_okonkwo", title: "Replace the escutcheon", location: "Shower", costCode: "PLB-SHOWER", assigneeUserId: null, assigneeContactId: "c_harbor", dueDate: addCalendarDays(punchToday, 2), status: "open", shared: 0, beforeDocumentId: null, afterDocumentId: null, doneAt: null, verifiedAt: null, createdBy: "user_sam", createdAt: daysAgo(1), updatedAt: daysAgo(1) },
      { id: "punch_ok_mirror", orgId: ORG, projectId: "proj_okonkwo", title: "Seal the mirror edge", location: "Vanity", costCode: null, assigneeUserId: null, assigneeContactId: null, dueDate: addCalendarDays(punchToday, 1), status: "open", shared: 1, beforeDocumentId: null, afterDocumentId: null, doneAt: null, verifiedAt: null, createdBy: "user_maya", createdAt: now, updatedAt: now },
      { id: "punch_dz_rail", orgId: ORG, projectId: "proj_diaz", title: "Tighten the rail", location: "Deck", costCode: "DECK-RAIL", assigneeUserId: "user_dana", assigneeContactId: null, dueDate: addCalendarDays(punchToday, -10), status: "verified", shared: 1, beforeDocumentId: null, afterDocumentId: null, doneAt: daysAgo(8), verifiedAt: daysAgo(6), createdBy: "user_maya", createdAt: daysAgo(9), updatedAt: daysAgo(6) },
      { id: "punch_dz_post", orgId: ORG, projectId: "proj_diaz", title: "Seal the post cap", location: "Stairs", costCode: "DECK-FOOT", assigneeUserId: "user_dana", assigneeContactId: null, dueDate: addCalendarDays(punchToday, -9), status: "verified", shared: 1, beforeDocumentId: null, afterDocumentId: null, doneAt: daysAgo(8), verifiedAt: daysAgo(6), createdBy: "user_maya", createdAt: daysAgo(9), updatedAt: daysAgo(6) },
    ])
    .run();

  const certExpires = addCalendarDays(punchToday, 18);
  db.insert(documents)
    .values({
      id: "doc_cert_harbor_gl",
      orgId: ORG,
      projectId: null,
      leadId: null,
      contactId: "c_harbor",
      type: "certificate",
      filename: "harbor-gl.png",
      storagePath: "/demo/photos/okonkwo-shower.svg",
      metadataJson: null,
      deletedAt: null,
      createdAt: daysAgo(20),
      createdBy: "user_sam",
    })
    .run();
  db.insert(vendorCertificates)
    .values({
      id: "vcert_harbor_gl",
      orgId: ORG,
      contactId: "c_harbor",
      type: "general_liability",
      expiresOn: certExpires,
      documentId: "doc_cert_harbor_gl",
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
    })
    .run();
  db.insert(vendorPortals)
    .values({
      id: "vport_harbor",
      orgId: ORG,
      contactId: "c_harbor",
      tokenHash: hashVendorToken(DEMO_HARBOR_PORTAL_TOKEN),
      createdAt: daysAgo(6),
      rotatedAt: null,
    })
    .run();

  db.insert(warrantyRequests)
    .values({
      id: "wr_dz_board",
      orgId: ORG,
      projectId: "proj_diaz",
      title: "Loose deck board",
      description: "A board lifted at the stair.",
      urgency: "soon",
      status: "submitted",
      visitDate: null,
      scheduleItemId: null,
      assigneeUserId: null,
      costCode: null,
      costItemId: null,
      clientNote: null,
      internalNote: "Check the ledger.",
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    })
    .run();

  db.insert(auditLogs)
    .values({
      id: "audit_seed",
      orgId: ORG,
      actorId: "user_maya",
      action: "seed",
      entityType: "organization",
      entityId: ORG,
      payloadJson: JSON.stringify({ version: SEED_VERSION }),
      ip: null,
      createdAt: now,
    })
    .run();

  db.insert(appMeta).values({ key: "seed_version", value: SEED_VERSION }).run();
}
