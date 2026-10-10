import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { resolveDataDir } from "@/lib/db/paths";
import type { AppDatabase } from "@/lib/db/client";
import { addMonths } from "@/lib/closeout/check";
import { usFederalHolidays } from "@/lib/schedule/holidays";
import { addCalendarDays, localDay, localWeek, zonedTimeToUtc } from "@/lib/time/calendar";
import { CATALOG_FORMULAS, northlineCatalog, riveraCatalog } from "@/lib/db/catalog";
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
  estimateMeasurements,
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
  jobTemplates,
  scheduleAssignees,
  scheduleLinks,
  templateChecks,
  templateDraws,
  templateInspectionGates,
  templateInspections,
  templateLines,
  templatePermits,
  templateSelections,
  templateTaskLinks,
  templateTasks,
  savedViews,
  scheduleBaselineItems,
  scheduleBaselines,
  scheduleDelays,
  scheduleItems,
  workdayExceptions,
  selectionChoices,
  selectionEvents,
  selections,
  leadFormSubmissions,
  leadForms,
  pipelines,
  assemblies,
  assemblyParts,
  clientUpdateVersions,
  clientUpdates,
  costCodeMarkups,
  invoiceCosts,
  priceBookItems,
  projects,
  punchItems,
  rfiMessages,
  rfis,
  submittalFiles,
  submittalRevisions,
  submittals,
  lienWaiverTemplates,
  lienWaivers,
  fileFolderDefaults,
  fileFolders,
  inspectionGates,
  inspections,
  jobFiles,
  markups,
  permits,
  planPins,
  equipment,
  equipmentAssignments,
  planRefs,
  recordFiles,
  commentFiles,
  commentMentions,
  comments,
  notifications,
  warrantyRequests,
  proposals,
  signatures,
  tasks,
  taskAssignees,
  taskChecks,
  templateTodoChecks,
  templateTodos,
  dailyLogEvents,
  dailyLogPhotos,
  dailyLogs,
  timeApprovals,
  timeEntries,
  timeEntryEvents,
  users,
  vendorCertificates,
  vendorPortals,
  bidInvites,
  bidLines,
  bidPrices,
  bidRequests,
  draws,
  payAppLines,
} from "@/lib/db/schema";
import { retainageByLine } from "@/lib/draws/math";
import { billableLaborCents, costPlusTotals, priceCost } from "@/lib/invoice/cost-plus";
import { assembleSnapshot, defaultSchedule, type StoredSnapshot } from "@/lib/domain/snapshot";
import { DEMO_ASSEMBLIES } from "@/lib/estimate/assembly";
import { vasquezLines, vasquezMeasurements, vasquezSections } from "@/lib/estimate/vasquez";
import { hashPassword, newSalt } from "@/lib/auth/password";
import { canonicalJson, sha256 } from "@/lib/esign/hash";
import { publicSnapshot } from "@/lib/selections/money";
import { daysAgo, daysFromNow, nowIso } from "@/lib/ids";
import { floorPlanPdf } from "@/lib/markup/pdf";
import { achFeeCents, formatMoney, qtyToMilli } from "@/lib/money";
import { CONSENT_VERSION, DEMO_PASSWORD } from "@/lib/product";
import { linkedDeadline } from "@/lib/todos/deadline";
import { hashVendorToken, DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import { DEFAULT_WAIVER_BODIES, renderWaiver } from "@/lib/waivers/format";
import { formatCalendarDay } from "@/lib/format";
import { renderUpdateBody } from "@/lib/updates/draft";
import { gatherClientUpdateFacts } from "@/lib/updates/gather";
import { defaultRange } from "@/lib/updates/range";
import { clientUpdateFromFacts } from "@/lib/ai/client-update";
import { proposalNudgeCopy } from "@/lib/ai/nurture";
import {
  defaultFields,
  DEMO_NORTH_FORM_TOKEN,
  DEMO_RIVERA_FORM_TOKEN,
  WEBSITE_FORM_SOURCE,
} from "@/lib/lead-form/rules";

export const SEED_VERSION = "37";

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
        lienWaiverMode: "warn",
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
        lienWaiverMode: "warn",
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
        defaultFormula: CATALOG_FORMULAS[item.code]?.expr ?? null,
        defaultWasteBps: CATALOG_FORMULAS[item.code]?.wasteBps ?? null,
        defaultRoundToMilli: CATALOG_FORMULAS[item.code]?.roundToMilli ?? null,
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
        defaultFormula: CATALOG_FORMULAS[item.code]?.expr ?? null,
        defaultWasteBps: CATALOG_FORMULAS[item.code]?.wasteBps ?? null,
        defaultRoundToMilli: CATALOG_FORMULAS[item.code]?.roundToMilli ?? null,
        lastUsedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_jordan",
      })),
    )
    .run();

  for (const assembly of DEMO_ASSEMBLIES) {
    db.insert(assemblies)
      .values({
        id: assembly.id,
        orgId: ORG,
        name: assembly.name,
        drive: assembly.drive,
        archivedAt: null,
        createdAt: created,
        updatedAt: now,
        createdBy: "user_maya",
      })
      .run();
    db.insert(assemblyParts)
      .values(
        assembly.parts.map((part, index) => ({
          id: part.id,
          orgId: ORG,
          assemblyId: assembly.id,
          name: part.name,
          priceBookItemId: part.code ? `pb_${part.code.toLowerCase()}` : null,
          costCode: part.code,
          unit: part.unit,
          unitCostCents: part.unitCostCents,
          formula: part.formula,
          wasteBps: part.wasteBps,
          roundToMilli: part.roundToMilli,
          sortOrder: index,
        })),
      )
      .run();
  }

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
        qtyFormula: line.formula ?? null,
        wasteBps: line.wasteBps ?? 0,
        roundToMilli: line.roundToMilli ?? null,
      })),
    )
    .run();
  db.insert(estimateMeasurements)
    .values(
      vasquezMeasurements.map((row) => ({
        id: row.id,
        orgId: ORG,
        estimateId: "est_vasquez",
        name: row.name,
        valueMilli: qtyToMilli(row.value),
        unit: row.unit,
        sortOrder: row.sortOrder,
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
      {
        id: "co_ok_rfi",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 4,
        title: "Relocate the shower valve",
        status: "draft",
        description: "Does the niche need added blocking?",
        priceDeltaCents: 180000,
        costDeltaCents: 180000,
        publicToken: "demo_co_okonkwo_rfi",
        sentAt: null,
        approvedAt: null,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
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
      {
        id: "col_ok_rfi",
        orgId: ORG,
        changeOrderId: "co_ok_rfi",
        name: "Relocate the shower valve",
        qtyMilli: 1000,
        unit: "ea",
        unitCostCents: 180000,
        markupBps: 0,
        priceCents: 180000,
        costCode: "RFI-MISC",
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
      { id: "cost_bill_hp510", orgId: ORG, projectId: "proj_okonkwo", budgetLineId: null, costCode: "PLB-SHOWER", amountCents: 200000, vendorName: "Harbor Plumbing", memo: "Bill HP-510", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(3), updatedAt: daysAgo(3), createdBy: "user_sam" },
      { id: "cost_bill_hp511", orgId: ORG, projectId: "proj_okonkwo", budgetLineId: null, costCode: "PLB-SHOWER", amountCents: 100000, vendorName: "Harbor Plumbing", memo: "Bill HP-511", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(2), updatedAt: daysAgo(2), createdBy: "user_sam" },
      { id: "cost_bill_sl", orgId: ORG, projectId: "proj_diaz", budgetLineId: null, costCode: "DECK-BOARD", amountCents: 125000, vendorName: "Summit Lumber", memo: "Bill SL-1904", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(12), updatedAt: daysAgo(8), createdBy: "user_sam" },
      { id: "cost_bill_be", orgId: ORG, projectId: "proj_brooks", budgetLineId: null, costCode: "ELE-KIT", amountCents: 700000, vendorName: "Brighton Electric", memo: "Bill BE-77", source: "bill", aiExtracted: 0, documentId: null, createdAt: daysAgo(10), updatedAt: daysAgo(10), createdBy: "user_sam" },
      { id: "cost_br_permit", orgId: ORG, projectId: "proj_brooks", budgetLineId: null, costCode: "GC-SUPER", amountCents: 18500, vendorName: "Austin", memo: "Permit B-2026-014", source: "permit", aiExtracted: 0, documentId: null, createdAt: daysAgo(20), updatedAt: daysAgo(20), createdBy: "user_maya" },
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
      {
        id: "bill_harbor_paid",
        orgId: ORG,
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        billNumber: "HP-220",
        billDate: addCalendarDays(billToday, -14),
        amountCents: 48000,
        dueDate: addCalendarDays(billToday, -6),
        status: "paid",
        memo: "Rough valve, paid",
        voidReason: null,
        paidAt: addCalendarDays(billToday, -4),
        payMethod: "check",
        payReference: "2201",
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(12),
        lowConfidence: 0,
        createdAt: daysAgo(14),
        updatedAt: daysAgo(4),
        createdBy: "user_sam",
      },
      {
        id: "bill_ok_harbor_req",
        orgId: ORG,
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        billNumber: "HP-442",
        billDate: addCalendarDays(billToday, -2),
        amountCents: 96000,
        dueDate: billDueSoon,
        status: "approved",
        memo: "Trim balance",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(1),
        lowConfidence: 0,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
        createdBy: "user_sam",
      },
      {
        id: "bill_ok_ret_ready",
        orgId: ORG,
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        billNumber: "HP-510",
        billDate: addCalendarDays(billToday, -3),
        amountCents: 200000,
        dueDate: billDueSoon,
        status: "approved",
        memo: "Retainage 10%",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: "po_ok_retain",
        approvedAt: daysAgo(2),
        lowConfidence: 0,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(2),
        createdBy: "user_sam",
        retainageCents: 20000,
        kind: "standard",
      },
      {
        id: "bill_ok_ret_blocked",
        orgId: ORG,
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        billNumber: "HP-511",
        billDate: addCalendarDays(billToday, -1),
        amountCents: 100000,
        dueDate: billDueSoon,
        status: "approved",
        memo: "Retainage 10%, waiver unsigned",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: "po_ok_retain",
        approvedAt: daysAgo(1),
        lowConfidence: 0,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_sam",
        retainageCents: 10000,
        kind: "standard",
      },
    ])
    .run();
  db.insert(billLines)
    .values([
      { id: "bln_ok_draft", orgId: ORG, billId: "bill_ok_draft", costCode: "TILE-SHOWER", description: "Niche tile", amountCents: 42000, costItemId: null, sortOrder: 0 },
      { id: "bln_ok_harbor", orgId: ORG, billId: "bill_ok_harbor", costCode: "PLB-SHOWER", description: "Valve and trim", amountCents: 150000, costItemId: "cost_bill_hp", sortOrder: 0 },
      { id: "bln_dz_summit", orgId: ORG, billId: "bill_dz_summit", costCode: "DECK-BOARD", description: "Extra boards", amountCents: 125000, costItemId: "cost_bill_sl", sortOrder: 0 },
      { id: "bln_br_brighton", orgId: ORG, billId: "bill_br_brighton", costCode: "ELE-KIT", description: "Rough electrical", amountCents: 700000, costItemId: "cost_bill_be", sortOrder: 0 },
      { id: "bln_harbor_paid", orgId: ORG, billId: "bill_harbor_paid", costCode: "PLB-SHOWER", description: "Rough valve", amountCents: 48000, costItemId: null, sortOrder: 0 },
      { id: "bln_harbor_req", orgId: ORG, billId: "bill_ok_harbor_req", costCode: "PLB-SHOWER", description: "Trim balance", amountCents: 96000, costItemId: null, sortOrder: 0 },
      { id: "bln_ok_ret_ready", orgId: ORG, billId: "bill_ok_ret_ready", costCode: "PLB-SHOWER", description: "Shower package", amountCents: 200000, costItemId: "cost_bill_hp510", sortOrder: 0 },
      { id: "bln_ok_ret_blocked", orgId: ORG, billId: "bill_ok_ret_blocked", costCode: "PLB-SHOWER", description: "Shower balance", amountCents: 100000, costItemId: "cost_bill_hp511", sortOrder: 0 },
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

  const harborPaidThrough = addCalendarDays(billToday, -14);
  const harborReqThrough = addCalendarDays(billToday, -2);
  const harborPaidBody = renderWaiver(DEFAULT_WAIVER_BODIES.conditional_progress, {
    vendor: "Harbor Plumbing",
    job: "Okonkwo primary bath",
    amount: formatMoney(48000),
    through: formatCalendarDay(harborPaidThrough),
    bill: "HP-220",
    company: "Rivera Remodeling & Trade",
  });
  const harborReqBody = renderWaiver(DEFAULT_WAIVER_BODIES.conditional_progress, {
    vendor: "Harbor Plumbing",
    job: "Okonkwo primary bath",
    amount: formatMoney(96000),
    through: formatCalendarDay(harborReqThrough),
    bill: "HP-442",
    company: "Rivera Remodeling & Trade",
  });
  db.insert(lienWaiverTemplates)
    .values(
      (["conditional_progress", "unconditional_progress", "conditional_final", "unconditional_final"] as const).flatMap((type) => [
        { id: `lwt_rivera_${type}`, orgId: ORG, type, body: DEFAULT_WAIVER_BODIES[type], updatedAt: daysAgo(1) },
        { id: `lwt_north_${type}`, orgId: NORTH, type, body: DEFAULT_WAIVER_BODIES[type], updatedAt: daysAgo(1) },
      ]),
    )
    .run();
  db.insert(lienWaivers)
    .values([
      {
        id: "lw_harbor_paid",
        orgId: ORG,
        billId: "bill_harbor_paid",
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        type: "conditional_progress",
        status: "signed",
        amountCents: 48000,
        throughDate: harborPaidThrough,
        body: harborPaidBody,
        signedName: "Pete Alvarez",
        signedAt: daysAgo(2),
        signedText: harborPaidBody,
        documentId: null,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(2),
        createdBy: "user_sam",
      },
      {
        id: "lw_harbor_req",
        orgId: ORG,
        billId: "bill_ok_harbor_req",
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        type: "conditional_progress",
        status: "requested",
        amountCents: 96000,
        throughDate: harborReqThrough,
        body: harborReqBody,
        signedName: null,
        signedAt: null,
        signedText: null,
        documentId: null,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
      {
        id: "lw_harbor_ready",
        orgId: ORG,
        billId: "bill_ok_ret_ready",
        projectId: "proj_okonkwo",
        vendorContactId: "c_harbor",
        type: "conditional_progress",
        status: "signed",
        amountCents: 180000,
        throughDate: addCalendarDays(billToday, -3),
        body: renderWaiver(DEFAULT_WAIVER_BODIES.conditional_progress, {
          vendor: "Harbor Plumbing",
          job: "Okonkwo primary bath",
          amount: formatMoney(180000),
          through: formatCalendarDay(addCalendarDays(billToday, -3)),
          bill: "HP-510",
          company: "Rivera Remodeling & Trade",
        }),
        signedName: "Pete Alvarez",
        signedAt: daysAgo(1),
        signedText: renderWaiver(DEFAULT_WAIVER_BODIES.conditional_progress, {
          vendor: "Harbor Plumbing",
          job: "Okonkwo primary bath",
          amount: formatMoney(180000),
          through: formatCalendarDay(addCalendarDays(billToday, -3)),
          bill: "HP-510",
          company: "Rivera Remodeling & Trade",
        }),
        documentId: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
        createdBy: "user_sam",
      },
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
  db.insert(purchaseOrders)
    .values({
      id: "po_ok_retain",
      orgId: ORG,
      projectId: "proj_okonkwo",
      vendorContactId: "c_harbor",
      changeOrderId: null,
      number: "PO-1055",
      scope: "Shower package held at 10% until the final waiver.",
      status: "issued",
      voidReason: null,
      issuedAt: daysAgo(4),
      closedAt: null,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      createdBy: "user_sam",
      retainageBps: 1000,
    })
    .run();
  db.insert(purchaseOrderLines)
    .values({
      id: "pol_ok_retain",
      orgId: ORG,
      purchaseOrderId: "po_ok_retain",
      costCode: "PLB-SHOWER",
      description: "Shower package",
      amountCents: 500000,
      sortOrder: 0,
    })
    .run();
  db.insert(purchaseOrderEvents)
    .values([
      { id: "poe_ok_ret_created", orgId: ORG, purchaseOrderId: "po_ok_retain", actorId: "user_sam", type: "created", reason: null, beforeJson: null, afterJson: null, createdAt: daysAgo(4) },
      { id: "poe_ok_ret_issued", orgId: ORG, purchaseOrderId: "po_ok_retain", actorId: "user_sam", type: "issued", reason: null, beforeJson: null, afterJson: JSON.stringify({ status: "issued" }), createdAt: daysAgo(4) },
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
    { id: "sch_ok_demo", projectId: "proj_okonkwo", title: "Demo", start: addCalendarDays(today, -2), end: addCalendarDays(today, -1), time: null, status: "done", note: null, assignees: [] },
    { id: "sch_ok_tile", projectId: "proj_okonkwo", title: "Tile shower", start: today, end: tomorrow, time: "07:30", status: "confirmed", note: "Homeowner home after 3", assignees: ["user_dana"] },
    { id: "sch_ok_plumb", projectId: "proj_okonkwo", title: "Set the valve", start: today, end: today, time: "09:00", status: "confirmed", note: null, assignees: [], vendorContactId: "c_harbor" },
    { id: "sch_chen_conflict", projectId: "proj_chen", title: "Vanity set", start: today, end: today, time: null, status: "planned", note: null, assignees: ["user_dana"] },
    { id: "sch_br_frame", projectId: "proj_brooks", title: "Framing walk", start: scheduleDay(0), end: scheduleDay(1), time: "08:00", status: "confirmed", note: null, assignees: ["user_luis"] },
    { id: "sch_ok_walk", projectId: "proj_okonkwo", title: "Client walk", start: scheduleDay(4), end: scheduleDay(4), time: null, status: "planned", note: null, assignees: ["user_maya"] },
    { id: "sch_dz_punch", projectId: "proj_diaz", title: "Punch list", start: scheduleDay(2), end: scheduleDay(2), time: null, status: "done", note: null, assignees: [] },
    { id: "sch_chen_measure", projectId: "proj_chen", title: "Measure", start: scheduleDay(8), end: scheduleDay(8), time: "09:00", status: "planned", note: null, assignees: ["user_sam"] },
    { id: "sch_br_delivery", projectId: "proj_brooks", title: "Window delivery", start: scheduleDay(10), end: scheduleDay(10), time: null, status: "confirmed", note: null, assignees: ["user_dana"] },
    { id: "sch_br_drywall", projectId: "proj_brooks", title: "Drywall", start: scheduleDay(8), end: scheduleDay(9), time: null, status: "planned", note: null, assignees: ["user_luis"], vendorContactId: "c_harbor" },
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

  const holidayYear = Number(today.slice(0, 4));
  const holidays = [...usFederalHolidays(holidayYear), ...usFederalHolidays(holidayYear + 1).filter((row) => !row.yearly)];
  db.insert(workdayExceptions)
    .values([
      ...holidays.map((row, index) => ({
        id: `wex_fed_${row.date}_${index}`,
        orgId: ORG,
        projectId: null,
        title: row.title,
        kind: "off" as const,
        startDate: row.date,
        endDate: row.date,
        yearly: row.yearly ? 1 : 0,
        createdAt: now,
        createdBy: "user_maya",
      })),
      {
        id: "wex_br_sat",
        orgId: ORG,
        projectId: "proj_brooks",
        title: "Saturday delivery",
        kind: "work",
        startDate: scheduleDay(5),
        endDate: scheduleDay(5),
        yearly: 0,
        createdAt: now,
        createdBy: "user_maya",
      },
    ])
    .run();
  db.insert(scheduleBaselines)
    .values([
      { id: "base_br_old", orgId: ORG, projectId: "proj_brooks", finishDate: scheduleDay(-2), current: 0, setAt: daysAgo(20), setBy: "user_maya" },
      { id: "base_br", orgId: ORG, projectId: "proj_brooks", finishDate: scheduleDay(1), current: 1, setAt: daysAgo(3), setBy: "user_maya" },
    ])
    .run();
  db.insert(scheduleBaselineItems)
    .values([
      { id: "bitem_br_frame_old", orgId: ORG, baselineId: "base_br_old", itemId: "sch_br_frame", startDate: scheduleDay(-4), endDate: scheduleDay(-2) },
      { id: "bitem_br_del_old", orgId: ORG, baselineId: "base_br_old", itemId: "sch_br_delivery", startDate: scheduleDay(-2), endDate: scheduleDay(-2) },
      { id: "bitem_br_frame", orgId: ORG, baselineId: "base_br", itemId: "sch_br_frame", startDate: scheduleDay(0), endDate: scheduleDay(1) },
      { id: "bitem_br_del", orgId: ORG, baselineId: "base_br", itemId: "sch_br_delivery", startDate: scheduleDay(1), endDate: scheduleDay(1) },
    ])
    .run();
  db.insert(scheduleDelays)
    .values([
      { id: "delay_br_weather", orgId: ORG, projectId: "proj_brooks", itemId: "sch_br_delivery", days: 3, reason: "weather", note: "Storm held the crane", actorId: "user_maya", createdAt: daysAgo(4) },
      { id: "delay_br_material", orgId: ORG, projectId: "proj_brooks", itemId: "sch_br_delivery", days: 2, reason: "material", note: null, actorId: "user_maya", createdAt: daysAgo(2) },
    ])
    .run();

  db.insert(permits)
    .values({
      id: "perm_br_bldg",
      orgId: ORG,
      projectId: "proj_brooks",
      permitType: "building",
      number: "B-2026-014",
      jurisdiction: "Austin",
      status: "issued",
      appliedOn: daysAgo(40).slice(0, 10),
      issuedOn: daysAgo(20).slice(0, 10),
      expiresOn: addCalendarDays(today, 21),
      feeCents: 18500,
      costCode: "GC-SUPER",
      costItemId: "cost_br_permit",
      showPassed: 1,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(1),
      createdBy: "user_maya",
    })
    .run();
  db.insert(inspections)
    .values([
      {
        id: "insp_br_frame",
        orgId: ORG,
        projectId: "proj_brooks",
        permitId: "perm_br_bldg",
        rootId: "insp_br_frame",
        attempt: 1,
        name: "Framing",
        scheduleItemId: "sch_br_frame",
        requestedOn: scheduleDay(0),
        scheduledOn: scheduleDay(1),
        inspector: "Alex Kim",
        result: "passed",
        resultOn: scheduleDay(1),
        notes: "",
        createdAt: daysAgo(12),
        updatedAt: daysAgo(8),
        createdBy: "user_maya",
      },
      {
        id: "insp_br_rough",
        orgId: ORG,
        projectId: "proj_brooks",
        permitId: "perm_br_bldg",
        rootId: "insp_br_rough",
        attempt: 1,
        name: "Rough plumbing",
        scheduleItemId: null,
        requestedOn: scheduleDay(3),
        scheduledOn: scheduleDay(4),
        inspector: "Pat Nguyen",
        result: "failed",
        resultOn: scheduleDay(4),
        notes: "Replace the vent stack\nStrap the supply",
        createdAt: daysAgo(6),
        updatedAt: daysAgo(2),
        createdBy: "user_maya",
      },
      {
        id: "insp_br_rough_2",
        orgId: ORG,
        projectId: "proj_brooks",
        permitId: "perm_br_bldg",
        rootId: "insp_br_rough",
        attempt: 2,
        name: "Rough plumbing",
        scheduleItemId: null,
        requestedOn: scheduleDay(5),
        scheduledOn: scheduleDay(8),
        inspector: null,
        result: "pending",
        resultOn: null,
        notes: "",
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
      {
        id: "insp_br_insul",
        orgId: ORG,
        projectId: "proj_brooks",
        permitId: "perm_br_bldg",
        rootId: "insp_br_insul",
        attempt: 1,
        name: "Insulation",
        scheduleItemId: null,
        requestedOn: scheduleDay(2),
        scheduledOn: scheduleDay(3),
        inspector: "Alex Kim",
        result: "failed",
        resultOn: scheduleDay(3),
        notes: "Add baffles at the eaves",
        createdAt: daysAgo(5),
        updatedAt: daysAgo(4),
        createdBy: "user_maya",
      },
    ])
    .run();
  db.insert(inspectionGates)
    .values({ id: "gate_br_drywall", orgId: ORG, inspectionId: "insp_br_rough_2", scheduleItemId: "sch_br_drywall" })
    .run();
  db.insert(tasks)
    .values([
      {
        id: "task_br_corr_1",
        orgId: ORG,
        title: "Replace the vent stack",
        assigneeUserId: "user_luis",
        dueAt: null,
        relatedType: "project",
        relatedId: "proj_brooks",
        status: "open",
        notes: "Rough plumbing",
        priority: "normal",
        tags: "inspection:insp_br_rough",
        scheduleItemId: null,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: null,
        remindedFor: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
        createdBy: "user_maya",
      },
      {
        id: "task_br_corr_2",
        orgId: ORG,
        title: "Strap the supply",
        assigneeUserId: "user_luis",
        dueAt: null,
        relatedType: "project",
        relatedId: "proj_brooks",
        status: "open",
        notes: "Rough plumbing",
        priority: "normal",
        tags: "inspection:insp_br_rough",
        scheduleItemId: null,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: null,
        remindedFor: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
        createdBy: "user_maya",
      },
    ])
    .run();

  const walkDue = linkedDeadline(tomorrow, -1);
  db.insert(tasks)
    .values([
      {
        id: "task_walk",
        orgId: ORG,
        title: "Pre-drywall walk",
        assigneeUserId: "user_dana",
        dueAt: walkDue,
        relatedType: "project",
        relatedId: "proj_okonkwo",
        status: "open",
        notes: "Before drywall",
        priority: "high",
        tags: "inspection",
        scheduleItemId: "sch_ok_tile",
        deadlineEdge: "finish",
        deadlineOffset: -1,
        deadlineUnlinked: 0,
        remindDays: 1,
        remindedFor: null,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
      {
        id: "task_tile_time",
        orgId: ORG,
        title: "Confirm the tile delivery",
        assigneeUserId: "user_maya",
        dueAt: tomorrow,
        relatedType: "project",
        relatedId: "proj_okonkwo",
        status: "open",
        notes: "",
        priority: "normal",
        tags: "",
        scheduleItemId: null,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: 1,
        remindedFor: null,
        createdAt: now,
        updatedAt: now,
        createdBy: "user_maya",
      },
      {
        id: "task_done",
        orgId: ORG,
        title: "Photograph the Diaz punch",
        assigneeUserId: "user_maya",
        dueAt: daysAgo(2),
        relatedType: "project",
        relatedId: "proj_diaz",
        status: "done",
        notes: "",
        priority: "low",
        tags: "",
        scheduleItemId: null,
        deadlineEdge: null,
        deadlineOffset: null,
        deadlineUnlinked: 0,
        remindDays: null,
        remindedFor: null,
        createdAt: daysAgo(4),
        updatedAt: daysAgo(2),
        createdBy: "user_maya",
      },
    ])
    .run();
  db.insert(taskAssignees)
    .values([
      { id: "tasn_walk_dana", orgId: ORG, taskId: "task_walk", userId: "user_dana", contactId: null },
      { id: "tasn_walk_maya", orgId: ORG, taskId: "task_walk", userId: "user_maya", contactId: null },
      { id: "tasn_tile_maya", orgId: ORG, taskId: "task_tile_time", userId: "user_maya", contactId: null },
      { id: "tasn_done_maya", orgId: ORG, taskId: "task_done", userId: "user_maya", contactId: null },
    ])
    .run();
  db.insert(taskChecks)
    .values([
      { id: "tchk_walk_water", orgId: ORG, taskId: "task_walk", title: "Water lines capped", sortOrder: 0, status: "open", assigneeUserId: "user_dana", assigneeContactId: null, dueAt: walkDue, completedAt: null, completedBy: null },
      { id: "tchk_walk_block", orgId: ORG, taskId: "task_walk", title: "Blocking in place", sortOrder: 1, status: "open", assigneeUserId: null, assigneeContactId: "c_harbor", dueAt: walkDue, completedAt: null, completedBy: null },
      { id: "tchk_walk_card", orgId: ORG, taskId: "task_walk", title: "Inspection card posted", sortOrder: 2, status: "open", assigneeUserId: null, assigneeContactId: null, dueAt: null, completedAt: null, completedBy: null },
      { id: "tchk_done_photo", orgId: ORG, taskId: "task_done", title: "Photos filed", sortOrder: 0, status: "done", assigneeUserId: "user_maya", assigneeContactId: null, dueAt: daysAgo(2), completedAt: daysAgo(2), completedBy: "user_maya" },
    ])
    .run();

  db.update(projects).set({ billingMode: "progress", retainageBps: 1000, updatedAt: now }).where(eq(projects.id, "proj_brooks")).run();
  db.update(invoices).set({ applicationNumber: 1, retainageCents: 344_000, updatedAt: now }).where(eq(invoices.id, "inv_br_prog")).run();
  const okDraws = [
    { id: "drw_ok_dep", title: "Deposit", amountCents: 1_680_000, invoiceId: "inv_ok_dep", scheduleItemId: null, dueOn: null, sortOrder: 0 },
    { id: "drw_ok_rough", title: "Rough-in", amountCents: 1_680_000, invoiceId: "inv_ok_prog", scheduleItemId: null, dueOn: null, sortOrder: 1 },
    { id: "drw_ok_tile", title: "Tile set", amountCents: 420_000, invoiceId: null, scheduleItemId: "sch_ok_demo", dueOn: null, sortOrder: 2 },
    { id: "drw_ok_trim", title: "Trim", amountCents: 420_000, invoiceId: null, scheduleItemId: null, dueOn: addCalendarDays(today, 21), sortOrder: 3 },
    { id: "drw_ok_final", title: "Final", amountCents: 420_000, invoiceId: null, scheduleItemId: null, dueOn: addCalendarDays(today, 45), sortOrder: 4 },
  ];
  db.insert(draws)
    .values(
      okDraws.map((draw) => ({
        id: draw.id,
        orgId: ORG,
        projectId: "proj_okonkwo",
        title: draw.title,
        basis: "fixed",
        bps: 0,
        amountCents: draw.amountCents,
        scheduleItemId: draw.scheduleItemId,
        dueOn: draw.dueOn,
        sortOrder: draw.sortOrder,
        invoiceId: draw.invoiceId,
        changeOrderId: null,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  const brooksWork = [
    { key: "bud_proj_brooks_0", name: "Demo and foundation patch", scheduledCents: 840_000 },
    { key: "bud_proj_brooks_1", name: "Framing", scheduledCents: 2_860_000 },
    { key: "bud_proj_brooks_2", name: "Windows and doors", scheduledCents: 1_220_000 },
    { key: "bud_proj_brooks_3", name: "Roof tie-in", scheduledCents: 980_000 },
    { key: "bud_proj_brooks_4", name: "Electrical and HVAC", scheduledCents: 1_140_000 },
    { key: "bud_proj_brooks_5", name: "Drywall and paint", scheduledCents: 820_000 },
    { key: "bud_proj_brooks_6", name: "Supervision", scheduledCents: 740_000 },
  ];
  const brooksThis = brooksWork.map((line) => Math.round(line.scheduledCents * 0.4));
  const brooksHold = retainageByLine(brooksThis, 1000);
  db.insert(payAppLines)
    .values(
      brooksWork.map((line, index) => ({
        id: `pal_br_${index}`,
        orgId: ORG,
        invoiceId: "inv_br_prog",
        sourceKey: line.key,
        name: line.name,
        scheduledCents: line.scheduledCents,
        previousCents: 0,
        thisCents: brooksThis[index] ?? 0,
        percentBps: 4000,
        retainageCents: brooksHold[index] ?? 0,
        sortOrder: index,
      })),
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
      { id: "punch_ok_curb", orgId: ORG, projectId: "proj_okonkwo", title: "Caulk the curb", location: "Shower", costCode: "TILE-SHOWER", assigneeUserId: "user_dana", assigneeContactId: null, dueDate: punchToday, status: "open", shared: 1, beforeDocumentId: "doc_o1", afterDocumentId: null, doneAt: null, verifiedAt: null, createdBy: "user_maya", createdAt: daysAgo(2), updatedAt: daysAgo(1) },
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

  const bidDue = addCalendarDays(punchToday, 2);
  db.insert(bidRequests)
    .values({
      id: "bid_ok_valve",
      orgId: ORG,
      projectId: "proj_okonkwo",
      title: "Shower plumbing and glass",
      scope: "Valve, trim, and glass",
      dueOn: bidDue,
      status: "out",
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
      createdBy: "user_maya",
      awardedAt: null,
      closedAt: null,
    })
    .run();
  db.insert(bidLines)
    .values([
      { id: "bln_ok_plb", orgId: ORG, bidId: "bid_ok_valve", costCode: "PLB-SHOWER", description: "Valve and trim", qtyMilli: 1000, unit: "ea", budgetLineId: "bud_proj_okonkwo_3", sortOrder: 0 },
      { id: "bln_ok_glass", orgId: ORG, bidId: "bid_ok_valve", costCode: "BATH-GLASS", description: "Shower glass", qtyMilli: 1000, unit: "ea", budgetLineId: "bud_proj_okonkwo_4", sortOrder: 1 },
    ])
    .run();
  db.insert(bidInvites)
    .values([
      { id: "binv_harbor", orgId: ORG, bidId: "bid_ok_valve", contactId: "c_harbor", status: "submitted", note: null, submittedName: "Pete Alvarez", submittedAt: daysAgo(1), declinedAt: null, declineReason: null, documentId: null },
      { id: "binv_casa", orgId: ORG, bidId: "bid_ok_valve", contactId: "c_casa", status: "submitted", note: null, submittedName: "Imani Brooks", submittedAt: daysAgo(1), declinedAt: null, declineReason: null, documentId: null },
      { id: "binv_brighton", orgId: ORG, bidId: "bid_ok_valve", contactId: "c_brighton", status: "invited", note: null, submittedName: null, submittedAt: null, declinedAt: null, declineReason: null, documentId: null },
    ])
    .run();
  db.insert(bidPrices)
    .values([
      { id: "bpr_h_plb", orgId: ORG, inviteId: "binv_harbor", bidLineId: "bln_ok_plb", unitPriceCents: 480000, noBid: 0 },
      { id: "bpr_h_glass", orgId: ORG, inviteId: "binv_harbor", bidLineId: "bln_ok_glass", unitPriceCents: 340000, noBid: 0 },
      { id: "bpr_c_plb", orgId: ORG, inviteId: "binv_casa", bidLineId: "bln_ok_plb", unitPriceCents: 610000, noBid: 0 },
      { id: "bpr_c_glass", orgId: ORG, inviteId: "binv_casa", bidLineId: "bln_ok_glass", unitPriceCents: 290000, noBid: 0 },
    ])
    .run();

  const rfiYesterday = addCalendarDays(punchToday, -1);
  db.insert(rfis)
    .values([
      {
        id: "rfi_ok_valve",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 1,
        title: "Valve height",
        question: "Confirm the shower valve height before tile.",
        dueOn: rfiYesterday,
        status: "open",
        assigneeKind: "vendor",
        assigneeUserId: null,
        assigneeContactId: "c_harbor",
        relatedType: "schedule",
        relatedId: "sch_ok_plumb",
        internalNote: "Do not share the allowance.",
        costImpact: 0,
        costImpactCents: null,
        scheduleImpactDays: null,
        changeOrderId: null,
        scheduleShiftedAt: null,
        answeredAt: null,
        closedAt: null,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(3),
        createdBy: "user_maya",
      },
      {
        id: "rfi_ok_vanity",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 2,
        title: "Vanity quartz",
        question: "Is quartz still the vanity?",
        dueOn: addCalendarDays(punchToday, 4),
        status: "answered",
        assigneeKind: "client",
        assigneeUserId: null,
        assigneeContactId: "c_okonkwo",
        relatedType: "selection",
        relatedId: "sel_ok_vanity",
        internalNote: null,
        costImpact: 0,
        costImpactCents: null,
        scheduleImpactDays: null,
        changeOrderId: null,
        scheduleShiftedAt: null,
        answeredAt: daysAgo(1),
        closedAt: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
      {
        id: "rfi_ok_niche",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 3,
        title: "Niche blocking",
        question: "Does the niche need added blocking?",
        dueOn: addCalendarDays(punchToday, -4),
        status: "closed",
        assigneeKind: "user",
        assigneeUserId: "user_luis",
        assigneeContactId: null,
        relatedType: "change_order",
        relatedId: "co_ok_1",
        internalNote: null,
        costImpact: 1,
        costImpactCents: 180000,
        scheduleImpactDays: null,
        changeOrderId: "co_ok_rfi",
        scheduleShiftedAt: null,
        answeredAt: daysAgo(2),
        closedAt: daysAgo(1),
        createdAt: daysAgo(4),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
    ])
    .run();
  db.insert(rfiMessages)
    .values([
      {
        id: "rfim_ok_vanity",
        orgId: ORG,
        rfiId: "rfi_ok_vanity",
        body: "Keep the quartz vanity.",
        authorKind: "client",
        authorUserId: null,
        authorName: "Amara Okonkwo",
        internal: 0,
        createdAt: daysAgo(1),
      },
      {
        id: "rfim_ok_niche",
        orgId: ORG,
        rfiId: "rfi_ok_niche",
        body: "Yes. Add blocking and price it.",
        authorKind: "user",
        authorUserId: "user_luis",
        authorName: "Luis Ortega",
        internal: 0,
        createdAt: daysAgo(2),
      },
    ])
    .run();

  const submittalYesterday = addCalendarDays(punchToday, -1);
  db.insert(documents)
    .values({
      id: "doc_sub_valve",
      orgId: ORG,
      projectId: "proj_okonkwo",
      leadId: null,
      contactId: "c_harbor",
      type: "submittal",
      filename: "valve-cut-sheet.pdf",
      storagePath: "uploads/org_rivera/doc_sub_valve.pdf",
      metadataJson: null,
      deletedAt: null,
      createdAt: daysAgo(1),
      createdBy: null,
    })
    .run();
  db.insert(submittals)
    .values([
      {
        id: "sub_ok_valve",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 1,
        title: "Shower valve cut sheet",
        specNote: "Pressure-balance valve, chrome trim, before tile.",
        division: "22 00",
        status: "submitted",
        dueOn: submittalYesterday,
        assigneeKind: "vendor",
        assigneeUserId: null,
        assigneeContactId: "c_harbor",
        relatedType: "schedule",
        relatedId: "sch_ok_plumb",
        internalNote: "Allowance stays in the office.",
        revision: 2,
        createdAt: daysAgo(4),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
      {
        id: "sub_ok_tile",
        orgId: ORG,
        projectId: "proj_okonkwo",
        number: 2,
        title: "Tile sample",
        specNote: "3x6 field tile, grout to match the niche.",
        division: "09 30",
        status: "review",
        dueOn: addCalendarDays(punchToday, 6),
        assigneeKind: "user",
        assigneeUserId: "user_maya",
        assigneeContactId: null,
        relatedType: null,
        relatedId: null,
        internalNote: null,
        revision: 1,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
        createdBy: "user_maya",
      },
    ])
    .run();
  db.insert(submittalRevisions)
    .values([
      {
        id: "subv_ok_valve_1",
        orgId: ORG,
        submittalId: "sub_ok_valve",
        revision: 1,
        note: "Cut sheet for the pressure-balance valve.",
        reviewNote: "Move the valve 2 inches.",
        authorName: "Harbor Plumbing",
        reviewerName: "Maya Rivera",
        createdAt: daysAgo(4),
        reviewedAt: daysAgo(2),
      },
      {
        id: "subv_ok_valve_2",
        orgId: ORG,
        submittalId: "sub_ok_valve",
        revision: 2,
        note: "Revised cut sheet, valve moved.",
        reviewNote: null,
        authorName: "Harbor Plumbing",
        reviewerName: null,
        createdAt: daysAgo(1),
        reviewedAt: null,
      },
      {
        id: "subv_ok_tile_1",
        orgId: ORG,
        submittalId: "sub_ok_tile",
        revision: 1,
        note: "Field sample for the shower wall.",
        reviewNote: null,
        authorName: "Maya Rivera",
        reviewerName: null,
        createdAt: daysAgo(1),
        reviewedAt: null,
      },
    ])
    .run();
  db.insert(submittalFiles)
    .values({
      id: "subf_ok_valve_2",
      orgId: ORG,
      submittalId: "sub_ok_valve",
      revisionId: "subv_ok_valve_2",
      documentId: "doc_sub_valve",
      createdAt: daysAgo(1),
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

  const commentAt = (hours: number) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
  db.insert(comments)
    .values([
      {
        id: "cmt_rfi_valve",
        orgId: ORG,
        entityType: "rfi",
        entityId: "rfi_ok_valve",
        projectId: "proj_okonkwo",
        authorId: "user_luis",
        body: "Valve center is 48 inches, confirm before tile @[user:user_maya]",
        createdAt: commentAt(3),
        editedAt: null,
        deletedAt: null,
      },
      {
        id: "cmt_rfi_valve_sam",
        orgId: ORG,
        entityType: "rfi",
        entityId: "rfi_ok_valve",
        projectId: "proj_okonkwo",
        authorId: "user_sam",
        body: "I'll confirm the spec",
        createdAt: commentAt(2),
        editedAt: null,
        deletedAt: null,
      },
      {
        id: "cmt_log_tile",
        orgId: ORG,
        entityType: "daily_log",
        entityId: "log_ok_yday",
        projectId: "proj_okonkwo",
        authorId: "user_dana",
        body: "Niche tile is on site. @[user:user_maya]",
        createdAt: commentAt(1),
        editedAt: null,
        deletedAt: null,
      },
    ])
    .run();
  db.insert(commentMentions)
    .values([
      { id: "cmn_valve_maya", orgId: ORG, commentId: "cmt_rfi_valve", kind: "user", userId: "user_maya", role: null },
      { id: "cmn_log_maya", orgId: ORG, commentId: "cmt_log_tile", kind: "user", userId: "user_maya", role: null },
    ])
    .run();
  db.insert(commentFiles)
    .values({ id: "cfile_log_tile", orgId: ORG, commentId: "cmt_log_tile", documentId: "doc_o1" })
    .run();
  db.insert(notifications)
    .values([
      {
        id: "note_valve_maya",
        orgId: ORG,
        userId: "user_maya",
        kind: "mention",
        commentId: "cmt_rfi_valve",
        entityType: "rfi",
        entityId: "rfi_ok_valve",
        projectId: "proj_okonkwo",
        actorId: "user_luis",
        actorName: "Luis Ortega",
        snippet: "Valve center is 48 inches, confirm before tile @Maya Rivera",
        readAt: null,
        createdAt: commentAt(3),
      },
      {
        id: "note_log_maya",
        orgId: ORG,
        userId: "user_maya",
        kind: "mention",
        commentId: "cmt_log_tile",
        entityType: "daily_log",
        entityId: "log_ok_yday",
        projectId: "proj_okonkwo",
        actorId: "user_dana",
        actorName: "Dana Cho",
        snippet: "Niche tile is on site. @Maya Rivera",
        readAt: null,
        createdAt: commentAt(1),
      },
      {
        id: "note_walk_maya",
        orgId: ORG,
        userId: "user_maya",
        kind: "assignment",
        commentId: null,
        entityType: "schedule_item",
        entityId: "sch_ok_walk",
        projectId: "proj_okonkwo",
        actorId: "user_luis",
        actorName: "Luis Ortega",
        snippet: "Assigned",
        readAt: null,
        createdAt: commentAt(4),
      },
    ])
    .run();
  db.insert(auditLogs)
    .values([
      {
        id: "audit_cmt_valve",
        orgId: ORG,
        actorId: "user_luis",
        action: "comment.create",
        entityType: "comment",
        entityId: "cmt_rfi_valve",
        payloadJson: JSON.stringify({ entityType: "rfi", entityId: "rfi_ok_valve" }),
        ip: null,
        createdAt: commentAt(3),
      },
      {
        id: "audit_cmt_log",
        orgId: ORG,
        actorId: "user_dana",
        action: "comment.create",
        entityType: "comment",
        entityId: "cmt_log_tile",
        payloadJson: JSON.stringify({ entityType: "daily_log", entityId: "log_ok_yday" }),
        ip: null,
        createdAt: commentAt(1),
      },
    ])
    .run();

  db.update(projects).set({ pmUserId: "user_luis" }).where(eq(projects.id, "proj_okonkwo")).run();
  db.update(projects).set({ pmUserId: "user_maya" }).where(eq(projects.id, "proj_brooks")).run();
  db.update(projects).set({ pmUserId: "user_maya" }).where(eq(projects.id, "proj_chen")).run();
  db.update(projects).set({ pmUserId: "user_luis" }).where(eq(projects.id, "proj_diaz")).run();
  const powderStart = daysAgo(20).slice(0, 10);
  const powderBill = daysAgo(14).slice(0, 10);
  const powderInvoice = daysAgo(8).slice(0, 10);
  db.insert(projects)
    .values({
      id: "proj_brooks_bath",
      orgId: ORG,
      leadId: null,
      proposalId: null,
      contactId: "c_brooks",
      name: "Brooks powder room",
      status: "active",
      address: "44 Canyon Rd, Orinda, CA",
      contractValueCents: 2_800_000,
      originalContractCents: 2_800_000,
      startDate: powderStart,
      endDate: null,
      portalToken: "demo_portal_brooks_bath",
      pmUserId: "user_luis",
      createdAt: daysAgo(21),
      updatedAt: daysAgo(40),
      createdBy: "user_maya",
    })
    .run();
  db.insert(budgetLines)
    .values([
      { id: "bud_bb_demo", orgId: ORG, projectId: "proj_brooks_bath", changeOrderId: null, name: "Demo", costCode: "DEMO-GUT", budgetCostCents: 400_000, budgetPriceCents: 560_000, sourceLineId: null, createdAt: daysAgo(21) },
      { id: "bud_bb_plumb", orgId: ORG, projectId: "proj_brooks_bath", changeOrderId: null, name: "Plumbing", costCode: "PLB-TOILET", budgetCostCents: 1_600_000, budgetPriceCents: 2_240_000, sourceLineId: null, createdAt: daysAgo(21) },
    ])
    .run();
  db.insert(costItems)
    .values({
      id: "cost_bb_plumb",
      orgId: ORG,
      projectId: "proj_brooks_bath",
      budgetLineId: "bud_bb_plumb",
      costCode: "PLB-TOILET",
      amountCents: 1_600_000,
      vendorName: "Summit Lumber",
      memo: "Rough and trim",
      source: "bill",
      aiExtracted: 0,
      documentId: null,
      createdAt: daysAgo(13),
      updatedAt: daysAgo(13),
      createdBy: "user_sam",
    })
    .run();
  db.insert(bills)
    .values({
      id: "bill_brooks_bath",
      orgId: ORG,
      projectId: "proj_brooks_bath",
      vendorContactId: "c_summit",
      billNumber: "SL-510",
      billDate: powderBill,
      amountCents: 1_600_000,
      dueDate: powderInvoice,
      status: "approved",
      memo: "Powder room lumber",
      voidReason: null,
      paidAt: null,
      payMethod: null,
      payReference: null,
      documentId: null,
      purchaseOrderId: null,
      approvedAt: daysAgo(13),
      lowConfidence: 0,
      createdAt: daysAgo(14),
      updatedAt: daysAgo(13),
      createdBy: "user_sam",
    })
    .run();
  db.insert(billLines)
    .values({
      id: "bln_brooks_bath",
      orgId: ORG,
      billId: "bill_brooks_bath",
      costCode: "PLB-TOILET",
      description: "Rough and trim",
      amountCents: 1_600_000,
      costItemId: "cost_bb_plumb",
      sortOrder: 0,
    })
    .run();
  db.insert(invoices)
    .values({
      id: "inv_brooks_bath",
      orgId: ORG,
      projectId: "proj_brooks_bath",
      changeOrderId: null,
      number: "RR-1058",
      type: "deposit",
      status: "open",
      scheduleIndex: 0,
      issueDate: powderInvoice,
      dueDate: daysAgo(1).slice(0, 10),
      subtotalCents: 560_000,
      taxCents: 0,
      totalCents: 560_000,
      amountPaidCents: 0,
      payToken: "demo_pay_brooks_bath",
      applicationNumber: null,
      retainageCents: 0,
      createdAt: daysAgo(8),
      updatedAt: daysAgo(8),
      createdBy: "user_sam",
    })
    .run();

  seedTemplates(db, now);

  db.insert(savedViews)
    .values([
      { id: "view_todos_overdue", orgId: ORG, userId: "user_maya", listKey: "todos", name: "My overdue", queryJson: JSON.stringify({ assignee: "user_maya", due: "overdue" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
      { id: "view_rfis_open", orgId: ORG, userId: "user_maya", listKey: "rfis", name: "Awaiting answer", queryJson: JSON.stringify({ status: "open" }), sortKey: null, sortDir: null, shared: 1, createdAt: now, updatedAt: now },
      { id: "view_todos_week", orgId: ORG, userId: "user_dana", listKey: "todos", name: "This week", queryJson: JSON.stringify({ due: "week" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
      { id: "view_todos_high", orgId: ORG, userId: "user_dana", listKey: "todos", name: "High", queryJson: JSON.stringify({ priority: "high" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
      { id: "view_leads_referral", orgId: ORG, userId: "user_luis", listKey: "leads", name: "Referral", queryJson: JSON.stringify({ source: "referral" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
      { id: "view_todos_luis", orgId: ORG, userId: "user_luis", listKey: "todos", name: "High", queryJson: JSON.stringify({ priority: "high" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
      { id: "view_bills_overdue", orgId: ORG, userId: "user_sam", listKey: "bills", name: "Overdue", queryJson: JSON.stringify({ status: "overdue" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
      { id: "view_pos_issued", orgId: ORG, userId: "user_sam", listKey: "purchase-orders", name: "Issued", queryJson: JSON.stringify({ status: "issued" }), sortKey: null, sortDir: null, shared: 0, createdAt: now, updatedAt: now },
    ])
    .run();

  const serviceDue = addCalendarDays(today, -88);
  db.insert(equipment)
    .values([
      { id: "eq_saw", orgId: ORG, name: "Track saw", category: "Tools", makeModel: "Makita SP6000", serial: "MK-441", tag: "T-101", purchasedOn: "2024-03-12", costCents: 64900, rateCents: 4500, rateUnit: "day", status: "available", locationKind: "yard", projectId: null, userId: null, notes: "", documentId: null, serviceInterval: 90, serviceUnit: "day", lastServiceOn: serviceDue, hoursSinceService: 0, lastSeenProjectId: null, lastSeenAt: null, createdAt: daysAgo(40), updatedAt: daysAgo(9), createdBy: "user_maya" },
      { id: "eq_laser", orgId: ORG, name: "Laser level", category: "Tools", makeModel: "Bosch GLL", serial: "BS-19", tag: "T-102", purchasedOn: "2025-01-08", costCents: 21900, rateCents: null, rateUnit: null, status: "available", locationKind: "yard", projectId: null, userId: null, notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: null, lastSeenAt: null, createdAt: daysAgo(30), updatedAt: daysAgo(2), createdBy: "user_maya" },
      { id: "eq_mixer", orgId: ORG, name: "Mud mixer", category: "Equipment", makeModel: "QEP", serial: "MX-7", tag: "T-103", purchasedOn: "2023-06-01", costCents: 89000, rateCents: 1800, rateUnit: "hour", status: "on_job", locationKind: "job", projectId: "proj_okonkwo", userId: "user_dana", notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 12, lastSeenProjectId: "proj_okonkwo", lastSeenAt: daysAgo(1), createdAt: daysAgo(20), updatedAt: daysAgo(4), createdBy: "user_maya" },
      { id: "eq_compactor", orgId: ORG, name: "Plate compactor", category: "Equipment", makeModel: "Wacker", serial: "PC-2", tag: "T-104", purchasedOn: "2022-11-15", costCents: 210000, rateCents: 7500, rateUnit: "day", status: "on_job", locationKind: "job", projectId: "proj_brooks", userId: "user_luis", notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: "proj_brooks", lastSeenAt: daysAgo(2), createdAt: daysAgo(60), updatedAt: daysAgo(2), createdBy: "user_maya" },
      { id: "eq_scaffold", orgId: ORG, name: "Scaffold set", category: "Access", makeModel: "Werner", serial: "SC-8", tag: "T-105", purchasedOn: "2021-04-20", costCents: 154000, rateCents: null, rateUnit: null, status: "with_person", locationKind: "person", projectId: null, userId: "user_sam", notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: null, lastSeenAt: null, createdAt: daysAgo(80), updatedAt: daysAgo(3), createdBy: "user_maya" },
      { id: "eq_nailer", orgId: ORG, name: "Finish nailer", category: "Tools", makeModel: "Metabo", serial: "FN-3", tag: "T-106", purchasedOn: "2024-08-02", costCents: 32900, rateCents: null, rateUnit: null, status: "in_service", locationKind: "yard", projectId: null, userId: null, notes: "Driver jammed.", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: null, lastSeenAt: null, createdAt: daysAgo(15), updatedAt: daysAgo(1), createdBy: "user_sam" },
      { id: "eq_ladder", orgId: ORG, name: "Extension ladder", category: "Access", makeModel: "Louisville", serial: "LD-12", tag: "T-107", purchasedOn: "2020-05-05", costCents: 28000, rateCents: null, rateUnit: null, status: "lost", locationKind: "yard", projectId: null, userId: null, notes: "Last on Chen.", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: "proj_chen", lastSeenAt: daysAgo(18), createdAt: daysAgo(100), updatedAt: daysAgo(6), createdBy: "user_maya" },
      { id: "eq_blower", orgId: ORG, name: "Blower", category: "Tools", makeModel: "Stihl", serial: "BL-1", tag: "T-108", purchasedOn: "2019-09-09", costCents: 16000, rateCents: null, rateUnit: null, status: "retired", locationKind: "yard", projectId: null, userId: null, notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: null, lastSeenAt: null, createdAt: daysAgo(200), updatedAt: daysAgo(30), createdBy: "user_maya" },
      { id: "eq_trailer", orgId: ORG, name: "Dump trailer", category: "Trailers", makeModel: "Big Tex", serial: "DT-4", tag: "T-109", purchasedOn: "2021-02-02", costCents: 640000, rateCents: 12000, rateUnit: "day", status: "on_job", locationKind: "job", projectId: "proj_diaz", userId: "user_dana", notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: "proj_diaz", lastSeenAt: daysAgo(40), createdAt: daysAgo(90), updatedAt: daysAgo(40), createdBy: "user_maya" },
      { id: "eq_heater", orgId: ORG, name: "Job heater", category: "Climate", makeModel: "Mr. Heater", serial: "HT-6", tag: "T-110", purchasedOn: "2025-11-01", costCents: 18900, rateCents: 2500, rateUnit: "day", status: "on_job", locationKind: "job", projectId: "proj_chen", userId: null, notes: "", documentId: null, serviceInterval: null, serviceUnit: null, lastServiceOn: null, hoursSinceService: 0, lastSeenProjectId: "proj_chen", lastSeenAt: daysAgo(1), createdAt: daysAgo(12), updatedAt: daysAgo(1), createdBy: "user_luis" },
    ])
    .run();
  db.insert(equipmentAssignments)
    .values([
      { id: "asn_saw_old", orgId: ORG, equipmentId: "eq_saw", projectId: "proj_brooks", userId: "user_dana", expectedReturn: addCalendarDays(today, -10), checkedOutAt: daysAgo(12), checkedInAt: daysAgo(9), fromLabel: "Yard", toLabel: "Brooks family room addition · Dana Cho", hours: null, costCents: null, costItemId: null, costState: "", createdAt: daysAgo(12), createdBy: "user_maya" },
      { id: "asn_mixer", orgId: ORG, equipmentId: "eq_mixer", projectId: "proj_okonkwo", userId: "user_dana", expectedReturn: yesterday, checkedOutAt: daysAgo(4), checkedInAt: null, fromLabel: "Yard", toLabel: "Okonkwo primary bath · Dana Cho", hours: null, costCents: null, costItemId: null, costState: "", createdAt: daysAgo(4), createdBy: "user_maya" },
      { id: "asn_compactor", orgId: ORG, equipmentId: "eq_compactor", projectId: "proj_brooks", userId: "user_luis", expectedReturn: addCalendarDays(today, 5), checkedOutAt: daysAgo(2), checkedInAt: null, fromLabel: "Yard", toLabel: "Brooks family room addition · Luis Ortega", hours: null, costCents: null, costItemId: null, costState: "", createdAt: daysAgo(2), createdBy: "user_sam" },
      { id: "asn_scaffold", orgId: ORG, equipmentId: "eq_scaffold", projectId: null, userId: "user_sam", expectedReturn: addCalendarDays(today, 2), checkedOutAt: daysAgo(3), checkedInAt: null, fromLabel: "Yard", toLabel: "Sam Patel", hours: null, costCents: null, costItemId: null, costState: "", createdAt: daysAgo(3), createdBy: "user_maya" },
      { id: "asn_trailer", orgId: ORG, equipmentId: "eq_trailer", projectId: "proj_diaz", userId: "user_dana", expectedReturn: null, checkedOutAt: daysAgo(40), checkedInAt: null, fromLabel: "Yard", toLabel: "Diaz deck replacement · Dana Cho", hours: null, costCents: null, costItemId: null, costState: "", createdAt: daysAgo(40), createdBy: "user_maya" },
      { id: "asn_heater", orgId: ORG, equipmentId: "eq_heater", projectId: "proj_chen", userId: null, expectedReturn: addCalendarDays(today, 3), checkedOutAt: daysAgo(1), checkedInAt: null, fromLabel: "Yard", toLabel: "Chen powder room", hours: null, costCents: null, costItemId: null, costState: "", createdAt: daysAgo(1), createdBy: "user_luis" },
    ])
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

  const publishedRange = defaultRange(Date.now(), riveraZone);
  const publishedFacts = gatherClientUpdateFacts(db, ORG, "proj_okonkwo", publishedRange, riveraZone);
  const publishedDraft = clientUpdateFromFacts(publishedFacts);
  const publishedBody = renderUpdateBody(publishedDraft);
  db.insert(clientUpdates)
    .values({
      id: "upd_ok_published",
      orgId: ORG,
      projectId: "proj_okonkwo",
      rangeStart: publishedRange.start,
      rangeEnd: publishedRange.end,
      status: "published",
      body: publishedBody,
      sourcesJson: JSON.stringify(publishedDraft),
      photoIdsJson: JSON.stringify(publishedDraft.photoIds),
      publishedAt: now,
      viewedAt: null,
      unpublishedAt: null,
      unpublishReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user_maya",
    })
    .run();
  db.insert(clientUpdateVersions)
    .values({
      id: "upv_ok_published",
      orgId: ORG,
      updateId: "upd_ok_published",
      version: 1,
      body: publishedBody,
      sourcesJson: JSON.stringify(publishedDraft),
      photoIdsJson: JSON.stringify(publishedDraft.photoIds),
      createdAt: now,
      createdBy: "user_maya",
    })
    .run();

  const draftEnd = addCalendarDays(publishedRange.start, -1);
  const draftRange = { start: addCalendarDays(draftEnd, -6), end: draftEnd };
  const draftFacts = gatherClientUpdateFacts(db, ORG, "proj_okonkwo", draftRange, riveraZone);
  const draftUpdate = clientUpdateFromFacts(draftFacts);
  db.insert(clientUpdates)
    .values({
      id: "upd_ok_draft",
      orgId: ORG,
      projectId: "proj_okonkwo",
      rangeStart: draftRange.start,
      rangeEnd: draftRange.end,
      status: "draft",
      body: renderUpdateBody(draftUpdate),
      sourcesJson: JSON.stringify(draftUpdate),
      photoIdsJson: JSON.stringify(draftUpdate.photoIds),
      publishedAt: null,
      viewedAt: null,
      unpublishedAt: null,
      unpublishReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user_maya",
    })
    .run();

  const ellisStart = addCalendarDays(today, -30);
  const ellisOld = addCalendarDays(today, -20);
  const ellisRecent = addCalendarDays(today, -3);
  const ellisLaborDay = addCalendarDays(today, -2);
  db.insert(projects)
    .values({
      id: "proj_ellis",
      orgId: ORG,
      leadId: "lead_web_ellis",
      proposalId: null,
      contactId: "c_ellis",
      name: "Ellis kitchen",
      status: "active",
      address: "18 Maple St, Oakland, CA",
      contractValueCents: 0,
      originalContractCents: 0,
      startDate: ellisStart,
      endDate: null,
      portalToken: "demo_portal_ellis",
      billingMode: "cost_plus",
      retainageBps: 0,
      markupBps: 2000,
      taxBps: 875,
      createdAt: daysAgo(30),
      updatedAt: now,
      createdBy: "user_maya",
    })
    .run();
  db.insert(budgetLines)
    .values([
      { id: "bud_ellis_cab", orgId: ORG, projectId: "proj_ellis", changeOrderId: null, name: "Cabinets", costCode: "CAB-BOX", budgetCostCents: 0, budgetPriceCents: 0, sourceLineId: null, createdAt: now },
      { id: "bud_ellis_plb", orgId: ORG, projectId: "proj_ellis", changeOrderId: null, name: "Plumbing", costCode: "PLB-ROUGH", budgetCostCents: 0, budgetPriceCents: 0, sourceLineId: null, createdAt: now },
      { id: "bud_ellis_sup", orgId: ORG, projectId: "proj_ellis", changeOrderId: null, name: "Supervision", costCode: "GC-SUPER", budgetCostCents: 0, budgetPriceCents: 0, sourceLineId: null, createdAt: now },
    ])
    .run();
  db.insert(costCodeMarkups).values({ id: "mkup_ellis_cab", orgId: ORG, projectId: "proj_ellis", costCode: "CAB-BOX", markupBps: 1500 }).run();
  db.update(laborRates).set({ hourlyBillCents: 8500 }).where(eq(laborRates.id, "rate_dana")).run();
  db.insert(bills)
    .values([
      {
        id: "bill_ellis_cab",
        orgId: ORG,
        projectId: "proj_ellis",
        vendorContactId: "c_mill",
        billNumber: "MC-19",
        billDate: ellisOld,
        amountCents: 125000,
        dueDate: addCalendarDays(today, -6),
        status: "approved",
        memo: "Cabinet note stays internal",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(18),
        lowConfidence: 0,
        createdAt: daysAgo(20),
        updatedAt: daysAgo(18),
        createdBy: "user_sam",
      },
      {
        id: "bill_ellis_plb",
        orgId: ORG,
        projectId: "proj_ellis",
        vendorContactId: "c_mill",
        billNumber: "HP-90",
        billDate: ellisRecent,
        amountCents: 80000,
        dueDate: addCalendarDays(today, 4),
        status: "approved",
        memo: "Valve note stays internal",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(2),
        lowConfidence: 0,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(2),
        createdBy: "user_sam",
      },
      {
        id: "bill_ellis_scrap",
        orgId: ORG,
        projectId: "proj_ellis",
        vendorContactId: "c_mill",
        billNumber: "MC-20",
        billDate: ellisRecent,
        amountCents: 5000,
        dueDate: addCalendarDays(today, 4),
        status: "approved",
        memo: "Scrap note stays internal",
        voidReason: null,
        paidAt: null,
        payMethod: null,
        payReference: null,
        documentId: null,
        purchaseOrderId: null,
        approvedAt: daysAgo(2),
        lowConfidence: 0,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(2),
        createdBy: "user_sam",
      },
    ])
    .run();
  db.insert(billLines)
    .values([
      { id: "bln_ellis_cab", orgId: ORG, billId: "bill_ellis_cab", costCode: "CAB-BOX", description: "Cabinet boxes", amountCents: 125000, costItemId: null, sortOrder: 0 },
      { id: "bln_ellis_plb", orgId: ORG, billId: "bill_ellis_plb", costCode: "PLB-ROUGH", description: "Supply lines", amountCents: 80000, costItemId: null, sortOrder: 0 },
      { id: "bln_ellis_scrap", orgId: ORG, billId: "bill_ellis_scrap", costCode: "CAB-BOX", description: "Shop scraps", amountCents: 5000, costItemId: null, sortOrder: 0 },
    ])
    .run();
  db.insert(documents)
    .values({
      id: "doc_receipt_ellis",
      orgId: ORG,
      projectId: "proj_ellis",
      leadId: null,
      contactId: "c_mill",
      type: "receipt",
      filename: "receipts/mill-cabinets.svg",
      storagePath: "/demo/receipts/mill-cabinets.svg",
      metadataJson: JSON.stringify({ vendor: "Mill & Co", amountCents: 45000, posted: true }),
      deletedAt: null,
      createdAt: daysAgo(4),
      createdBy: "user_dana",
    })
    .run();
  db.insert(costItems)
    .values({
      id: "cost_ellis_receipt",
      orgId: ORG,
      projectId: "proj_ellis",
      budgetLineId: null,
      costCode: "CAB-BOX",
      amountCents: 45000,
      vendorName: "Mill & Co",
      memo: "Shop ticket stays internal",
      source: "receipt",
      aiExtracted: 0,
      documentId: "doc_receipt_ellis",
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      createdBy: "user_sam",
    })
    .run();
  const laborIn = riveraAt(ellisLaborDay, 8);
  const laborOut = riveraAt(ellisLaborDay, 12);
  db.insert(timeEntries)
    .values({
      id: "time_ellis_labor",
      orgId: ORG,
      userId: "user_dana",
      projectId: "proj_ellis",
      costCode: "GC-SUPER",
      status: "approved",
      clockInAt: laborIn,
      clockOutAt: laborOut,
      breakMinutes: 0,
      breakStartedAt: null,
      note: "Dana's private note",
      clockInLatE6: null,
      clockInLngE6: null,
      clockOutLatE6: null,
      clockOutLngE6: null,
      source: "manual",
      createdAt: laborIn,
      updatedAt: laborOut,
      createdBy: "user_maya",
    })
    .run();
  const laborCents = billableLaborCents(240, 8500);
  db.insert(timeApprovals)
    .values({
      id: "tap_ellis_labor",
      orgId: ORG,
      entryId: "time_ellis_labor",
      rateCents: 5200,
      minutes: 240,
      amountCents: billableLaborCents(240, 5200),
      costItemId: null,
      status: "active",
      reason: null,
      createdAt: laborOut,
      createdBy: "user_maya",
    })
    .run();
  const plumb = priceCost(80000, 2000);
  const receipt = priceCost(45000, 1500);
  const labor = priceCost(laborCents, 2000);
  const scrap = priceCost(5000, 1500);
  const totals = costPlusTotals(
    [
      { costCents: plumb.costCents, markupBps: 2000 },
      { costCents: receipt.costCents, markupBps: 1500 },
      { costCents: labor.costCents, markupBps: 2000 },
    ],
    875,
  );
  db.insert(invoices)
    .values({
      id: "inv_ellis_draft",
      orgId: ORG,
      projectId: "proj_ellis",
      changeOrderId: null,
      number: "RR-1070",
      type: "cost_plus",
      status: "draft",
      scheduleIndex: null,
      issueDate: today,
      dueDate: addCalendarDays(today, 7),
      subtotalCents: totals.priceCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      amountPaidCents: 0,
      payToken: "demo_pay_ellis_draft",
      applicationNumber: null,
      retainageCents: 0,
      presentAs: "grouped",
      markupDisplay: "baked",
      createdAt: now,
      updatedAt: now,
      createdBy: "user_maya",
    })
    .run();
  db.insert(invoiceLines)
    .values([
      { id: "invl_ellis_cab", orgId: ORG, invoiceId: "inv_ellis_draft", description: "Cabinets", amountCents: receipt.priceCents, sortOrder: 0 },
      { id: "invl_ellis_plb", orgId: ORG, invoiceId: "inv_ellis_draft", description: "Plumbing", amountCents: plumb.priceCents, sortOrder: 1 },
      { id: "invl_ellis_sup", orgId: ORG, invoiceId: "inv_ellis_draft", description: "Supervision", amountCents: labor.priceCents, sortOrder: 2 },
    ])
    .run();
  db.insert(invoiceCosts)
    .values([
      { id: "icost_ellis_plb", orgId: ORG, projectId: "proj_ellis", invoiceId: "inv_ellis_draft", sourceKind: "bill", sourceId: "bln_ellis_plb", costCode: "PLB-ROUGH", label: "Mill & Co Cabinets · HP-90 · Supply lines", occurredOn: ellisRecent, costCents: plumb.costCents, markupBps: 2000, markupCents: plumb.markupCents, priceCents: plumb.priceCents, nonBillable: 0, createdAt: now },
      { id: "icost_ellis_receipt", orgId: ORG, projectId: "proj_ellis", invoiceId: "inv_ellis_draft", sourceKind: "receipt", sourceId: "cost_ellis_receipt", costCode: "CAB-BOX", label: "Mill & Co", occurredOn: localDay(Date.parse(daysAgo(4)), riveraZone), costCents: receipt.costCents, markupBps: 1500, markupCents: receipt.markupCents, priceCents: receipt.priceCents, nonBillable: 0, createdAt: now },
      { id: "icost_ellis_labor", orgId: ORG, projectId: "proj_ellis", invoiceId: "inv_ellis_draft", sourceKind: "time", sourceId: "time_ellis_labor", costCode: "GC-SUPER", label: "Labor, 4 h", occurredOn: ellisLaborDay, costCents: labor.costCents, markupBps: 2000, markupCents: labor.markupCents, priceCents: labor.priceCents, nonBillable: 0, createdAt: now },
      { id: "icost_ellis_scrap", orgId: ORG, projectId: "proj_ellis", invoiceId: null, sourceKind: "bill", sourceId: "bln_ellis_scrap", costCode: "CAB-BOX", label: "Mill & Co Cabinets · MC-20 · Shop scraps", occurredOn: ellisRecent, costCents: scrap.costCents, markupBps: 1500, markupCents: scrap.markupCents, priceCents: scrap.priceCents, nonBillable: 1, createdAt: now },
    ])
    .run();
  db.insert(clientUpdates)
    .values({
      id: "upd_ellis_published",
      orgId: ORG,
      projectId: "proj_ellis",
      rangeStart: addCalendarDays(today, -6),
      rangeEnd: today,
      status: "published",
      body: "This week\nCabinets are on site.",
      sourcesJson: JSON.stringify({ sections: [], photoIds: [] }),
      photoIdsJson: "[]",
      publishedAt: now,
      viewedAt: null,
      unpublishedAt: null,
      unpublishReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user_maya",
    })
    .run();
}

function seedTemplates(db: AppDatabase, now: string) {
  const bathTasks = [
    { key: "demo", title: "Demo", offset: 0, duration: 2, trade: "Demo", preds: [] as { key: string; lag: number }[] },
    { key: "plumb", title: "Rough plumbing", offset: 2, duration: 2, trade: "Plumbing", preds: [{ key: "demo", lag: 0 }] },
    { key: "tile", title: "Tile shower", offset: 4, duration: 3, trade: "Tile", preds: [{ key: "plumb", lag: 0 }] },
    { key: "vanity", title: "Set vanity", offset: 7, duration: 1, trade: "Crew", preds: [{ key: "tile", lag: 0 }] },
    { key: "walk", title: "Client walk", offset: 8, duration: 1, trade: "Crew", preds: [{ key: "vanity", lag: 0 }] },
  ];
  const kitchenTasks = [
    { key: "demo", title: "Demo", offset: 0, duration: 2, trade: "Demo", preds: [] as { key: string; lag: number }[] },
    { key: "plumb", title: "Rough plumbing", offset: 2, duration: 2, trade: "Plumbing", preds: [{ key: "demo", lag: 0 }] },
    { key: "elec", title: "Rough electrical", offset: 2, duration: 2, trade: "Electrical", preds: [{ key: "demo", lag: 0 }] },
    { key: "cabs", title: "Cabinets", offset: 4, duration: 3, trade: "Cabinets", preds: [{ key: "plumb", lag: 0 }, { key: "elec", lag: 0 }] },
    { key: "tops", title: "Counters", offset: 7, duration: 2, trade: "Stone", preds: [{ key: "cabs", lag: 0 }] },
    { key: "apps", title: "Appliances", offset: 7, duration: 1, trade: "Appliance", preds: [{ key: "cabs", lag: 0 }] },
    { key: "splash", title: "Backsplash", offset: 9, duration: 2, trade: "Tile", preds: [{ key: "tops", lag: 0 }] },
  ];
  const vendorPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const uploadDir = path.join(resolveDataDir(), "uploads", ORG);
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, "doc_ok_a101_r1.pdf"), floorPlanPdf("A-101 Rev 1"));
  fs.writeFileSync(path.join(uploadDir, "doc_ok_a101_r2.pdf"), floorPlanPdf("A-101 Rev 2"));
  fs.writeFileSync(path.join(uploadDir, "doc_ok_harbor.png"), vendorPng);
  const folderDefaults = [
    { key: "plans", name: "Plans", kind: "plans", visibility: "team", sort: 0 },
    { key: "specs", name: "Specs", kind: "general", visibility: "team", sort: 1 },
    { key: "contracts", name: "Contracts", kind: "general", visibility: "team", sort: 2 },
    { key: "photos", name: "Photos", kind: "photos", visibility: "team", sort: 3 },
  ];
  db.insert(fileFolderDefaults)
    .values(
      folderDefaults.flatMap((row) => [
        { id: `fd_rivera_${row.key}`, orgId: ORG, name: row.name, kind: row.kind, visibility: row.visibility, sortOrder: row.sort, archivedAt: null },
        { id: `fd_north_${row.key}`, orgId: NORTH, name: row.name, kind: row.kind, visibility: row.visibility, sortOrder: row.sort, archivedAt: null },
      ]),
    )
    .run();
  db.insert(fileFolders)
    .values([
      { id: "ff_ok_plans", orgId: ORG, projectId: "proj_okonkwo", name: "Plans", kind: "plans", visibility: "subs", vendorContactId: null, sortOrder: 0, archivedAt: null, createdAt: daysAgo(8), updatedAt: daysAgo(1) },
      { id: "ff_ok_specs", orgId: ORG, projectId: "proj_okonkwo", name: "Specs", kind: "general", visibility: "team", vendorContactId: null, sortOrder: 1, archivedAt: null, createdAt: daysAgo(8), updatedAt: daysAgo(8) },
      { id: "ff_ok_contracts", orgId: ORG, projectId: "proj_okonkwo", name: "Contracts", kind: "general", visibility: "team", vendorContactId: null, sortOrder: 2, archivedAt: null, createdAt: daysAgo(8), updatedAt: daysAgo(8) },
      { id: "ff_ok_photos", orgId: ORG, projectId: "proj_okonkwo", name: "Photos", kind: "photos", visibility: "client", vendorContactId: null, sortOrder: 3, archivedAt: null, createdAt: daysAgo(8), updatedAt: daysAgo(8) },
      { id: "ff_ok_harbor", orgId: ORG, projectId: "proj_okonkwo", name: "Harbor Plumbing", kind: "vendor", visibility: "vendor", vendorContactId: "c_harbor", sortOrder: 4, archivedAt: null, createdAt: daysAgo(2), updatedAt: daysAgo(2) },
    ])
    .run();
  db.insert(documents)
    .values([
      { id: "doc_ok_a101_r1", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "job_file", filename: "a101-floor-plan.pdf", storagePath: "uploads/org_rivera/doc_ok_a101_r1.pdf", metadataJson: null, deletedAt: null, createdAt: daysAgo(8), createdBy: "user_luis" },
      { id: "doc_ok_a101_r2", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "job_file", filename: "a101-floor-plan.pdf", storagePath: "uploads/org_rivera/doc_ok_a101_r2.pdf", metadataJson: null, deletedAt: null, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "doc_ok_harbor", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: "c_harbor", type: "job_file", filename: "valve-photo.png", storagePath: "uploads/org_rivera/doc_ok_harbor.png", metadataJson: null, deletedAt: null, createdAt: daysAgo(2), createdBy: null },
    ])
    .run();
  db.insert(jobFiles)
    .values([
      { id: "jf_ok_a101_r1", orgId: ORG, projectId: "proj_okonkwo", folderId: "ff_ok_plans", documentId: "doc_ok_a101_r1", name: "A-101 floor plan", revisionGroupId: "grp_ok_a101", revision: 1, isCurrent: 0, visibilityOverride: null, shareHistory: 0, byteSize: 880_640, uploadedByName: "Luis Ortega", uploadedByUserId: "user_luis", uploadedByContactId: null, deletedAt: null, createdAt: daysAgo(8) },
      { id: "jf_ok_a101_r2", orgId: ORG, projectId: "proj_okonkwo", folderId: "ff_ok_plans", documentId: "doc_ok_a101_r2", name: "A-101 floor plan", revisionGroupId: "grp_ok_a101", revision: 2, isCurrent: 1, visibilityOverride: null, shareHistory: 0, byteSize: 1_468_007, uploadedByName: "Maya Rivera", uploadedByUserId: "user_maya", uploadedByContactId: null, deletedAt: null, createdAt: daysAgo(1) },
      { id: "jf_ok_harbor", orgId: ORG, projectId: "proj_okonkwo", folderId: "ff_ok_harbor", documentId: "doc_ok_harbor", name: "Valve photo", revisionGroupId: "grp_ok_harbor", revision: 1, isCurrent: 1, visibilityOverride: null, shareHistory: 0, byteSize: 245_760, uploadedByName: "Harbor Plumbing", uploadedByUserId: null, uploadedByContactId: "c_harbor", deletedAt: null, createdAt: daysAgo(2) },
    ])
    .run();
  db.insert(planRefs)
    .values([
      { id: "pref_ok_bid", orgId: ORG, targetType: "bid", targetId: "bid_ok_valve", revisionGroupId: "grp_ok_a101", createdAt: daysAgo(1) },
      { id: "pref_ok_po", orgId: ORG, targetType: "purchase_order", targetId: "po_ok_harbor", revisionGroupId: "grp_ok_a101", createdAt: daysAgo(1) },
    ])
    .run();
  db.insert(documents)
    .values([
      { id: "doc_ok_curb_flat", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "markup", filename: "curb-marked.svg", storagePath: "/demo/photos/okonkwo-curb-marked.svg", metadataJson: null, deletedAt: null, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "doc_pin_curb", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "plan_crop", filename: "pin-curb.svg", storagePath: "/demo/plans/pin-curb.svg", metadataJson: null, deletedAt: null, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "doc_pin_vanity", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "plan_crop", filename: "pin-vanity.svg", storagePath: "/demo/plans/pin-vanity.svg", metadataJson: null, deletedAt: null, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "doc_pin_valve", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "plan_crop", filename: "pin-valve.svg", storagePath: "/demo/plans/pin-valve.svg", metadataJson: null, deletedAt: null, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "doc_pin_r1", orgId: ORG, projectId: "proj_okonkwo", leadId: null, contactId: null, type: "plan_crop", filename: "pin-r1.svg", storagePath: "/demo/plans/pin-r1.svg", metadataJson: null, deletedAt: null, createdAt: daysAgo(8), createdBy: "user_luis" },
    ])
    .run();
  db.insert(markups)
    .values({
      id: "mk_ok_curb",
      orgId: ORG,
      projectId: "proj_okonkwo",
      targetType: "photo",
      targetId: "doc_o1",
      sourceDocumentId: "doc_o1",
      page: 1,
      layerJson: JSON.stringify({ shapes: [{ id: "s_curb", tool: "ellipse", color: "red", points: [{ x: 0.42, y: 0.28 }, { x: 0.62, y: 0.48 }] }] }),
      flatDocumentId: "doc_ok_curb_flat",
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      createdBy: "user_maya",
      updatedBy: "user_maya",
    })
    .run();
  db.insert(planPins)
    .values([
      { id: "pin_ok_curb", orgId: ORG, projectId: "proj_okonkwo", jobFileId: "jf_ok_a101_r2", number: 1, xMilli: 294, yMilli: 318, linkType: "punch", linkId: "punch_ok_curb", note: "", cropDocumentId: "doc_pin_curb", copiedFromId: null, reviewed: 1, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "pin_ok_vanity", orgId: ORG, projectId: "proj_okonkwo", jobFileId: "jf_ok_a101_r2", number: 2, xMilli: 686, yMilli: 318, linkType: "punch", linkId: "punch_ok_vanity", note: "", cropDocumentId: "doc_pin_vanity", copiedFromId: null, reviewed: 1, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "pin_ok_valve", orgId: ORG, projectId: "proj_okonkwo", jobFileId: "jf_ok_a101_r2", number: 3, xMilli: 506, yMilli: 722, linkType: "rfi", linkId: "rfi_ok_valve", note: "Check before tile.", cropDocumentId: "doc_pin_valve", copiedFromId: null, reviewed: 1, createdAt: daysAgo(1), createdBy: "user_maya" },
      { id: "pin_ok_r1", orgId: ORG, projectId: "proj_okonkwo", jobFileId: "jf_ok_a101_r1", number: 1, xMilli: 200, yMilli: 240, linkType: "punch", linkId: "punch_ok_paint", note: "Superseded.", cropDocumentId: "doc_pin_r1", copiedFromId: null, reviewed: 1, createdAt: daysAgo(8), createdBy: "user_luis" },
    ])
    .run();
  db.insert(auditLogs)
    .values({
      id: "audit_mk_curb",
      orgId: ORG,
      actorId: "user_maya",
      action: "markup.save",
      entityType: "markup",
      entityId: "mk_ok_curb",
      payloadJson: JSON.stringify({ targetType: "photo", targetId: "doc_o1" }),
      ip: null,
      createdAt: daysAgo(1),
    })
    .run();

  const templates = [
    {
      id: "tpl_bath",
      name: "Bathroom remodel",
      jobType: "Bath",
      tasks: bathTasks,
      lines: [
        ["Bath demolition", "DEMO-GUT", 210000, 320000],
        ["Shower tile", "TILE-SHOWER", 980000, 1480000],
        ["Vanity and top", "BATH-VANITY", 410000, 620000],
        ["Plumbing", "PLB-SHOWER", 520000, 740000],
        ["Shower glass", "BATH-GLASS", 320000, 460000],
        ["Paint and supervision", "GC-SUPER", 300000, 580000],
      ],
      draws: [
        ["Deposit", 3000],
        ["Rough-in", 3000],
        ["Tile set", 2000],
        ["Final", 2000],
      ],
      selections: [
        ["Vanity", "Bath", 620000],
        ["Floor tile", "Bath", 180000],
      ],
      checks: ["Reset the GFCI", "Caulk the niche", "Walk the punch list"],
    },
    {
      id: "tpl_kitchen",
      name: "Kitchen remodel",
      jobType: "Kitchen",
      tasks: kitchenTasks,
      lines: [
        ["Kitchen demolition", "DEMO-GUT", 180000, 280000],
        ["Rough plumbing", "PLB-KITCH", 640000, 920000],
        ["Rough electrical", "ELE-KITCH", 480000, 700000],
        ["Base cabinets", "CAB-BASE", 2200000, 3400000],
        ["Countertop", "STN-TOP", 980000, 1540000],
        ["Appliances", "APP-PKG", 1400000, 1680000],
        ["Backsplash", "TILE-BACK", 420000, 640000],
      ],
      draws: [
        ["Deposit", 2500],
        ["Rough", 2500],
        ["Cabinets", 2500],
        ["Final", 2500],
      ],
      selections: [
        ["Cabinet pulls", "Kitchen", 48000],
        ["Sink", "Kitchen", 62000],
      ],
      checks: ["Adjust the doors", "Seal the sink", "Test the dishwasher"],
    },
  ] as const;
  db.insert(jobTemplates)
    .values(
      templates.map((template) => ({
        id: template.id,
        orgId: ORG,
        name: template.name,
        jobType: template.jobType,
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "user_maya",
      })),
    )
    .run();
  for (const template of templates) {
    db.insert(templateTasks)
      .values(
        template.tasks.map((task, index) => ({
          id: `${template.id}_${task.key}`,
          orgId: ORG,
          templateId: template.id,
          itemKey: task.key,
          title: task.title,
          phase: null,
          startOffset: task.offset,
          durationWorkdays: task.duration,
          trade: task.trade,
          sortOrder: index,
        })),
      )
      .run();
    const links = template.tasks.flatMap((task) =>
      task.preds.map((pred, index) => ({
        id: `${template.id}_${task.key}_${pred.key}`,
        orgId: ORG,
        templateId: template.id,
        itemKey: task.key,
        predecessorKey: pred.key,
        lagWorkdays: pred.lag || index * 0,
      })),
    );
    if (links.length) db.insert(templateTaskLinks).values(links).run();
    db.insert(templateLines)
      .values(
        template.lines.map((line, index) => ({
          id: `${template.id}_line_${index}`,
          orgId: ORG,
          templateId: template.id,
          name: line[0],
          costCode: line[1],
          qtyMilli: 1000,
          unit: "ea",
          unitCostCents: line[2],
          unitPriceCents: line[3],
          sortOrder: index,
          qtyFormula: CATALOG_FORMULAS[line[1]]?.expr ?? null,
          wasteBps: CATALOG_FORMULAS[line[1]]?.wasteBps ?? 0,
          roundToMilli: CATALOG_FORMULAS[line[1]]?.roundToMilli ?? null,
        })),
      )
      .run();
    db.insert(templateDraws)
      .values(
        template.draws.map((draw, index) => ({
          id: `${template.id}_draw_${index}`,
          orgId: ORG,
          templateId: template.id,
          title: draw[0],
          bps: draw[1],
          sortOrder: index,
        })),
      )
      .run();
    db.insert(templateSelections)
      .values(
        template.selections.map((row, index) => ({
          id: `${template.id}_sel_${index}`,
          orgId: ORG,
          templateId: template.id,
          title: row[0],
          area: row[1],
          allowanceCents: row[2],
          sortOrder: index,
        })),
      )
      .run();
    db.insert(templateChecks)
      .values(
        template.checks.map((title, index) => ({
          id: `${template.id}_chk_${index}`,
          orgId: ORG,
          templateId: template.id,
          title,
          kind: "punch",
          sortOrder: index,
        })),
      )
      .run();
    const todoId = `${template.id}_walk`;
    db.insert(templateTodos)
      .values({
        id: todoId,
        orgId: ORG,
        templateId: template.id,
        title: "Pre-drywall walk",
        notes: "",
        priority: "normal",
        tags: "inspection",
        remindDays: 1,
        scheduleKey: "plumb",
        deadlineEdge: "finish",
        deadlineOffset: -1,
        sortOrder: 0,
      })
      .run();
    db.insert(templateTodoChecks)
      .values(
        ["Water lines capped", "Blocking in place", "Inspection card posted"].map((title, index) => ({
          id: `${todoId}_${index}`,
          orgId: ORG,
          templateId: template.id,
          todoId,
          title,
          sortOrder: index,
        })),
      )
      .run();
  }
  db.insert(fileFolders)
    .values({ id: "ff_br_photos", orgId: ORG, projectId: "proj_brooks", name: "Photos", kind: "photos", visibility: "team", vendorContactId: null, sortOrder: 0, archivedAt: null, createdAt: now, updatedAt: now })
    .run();
  db.insert(jobFiles)
    .values({
      id: "jf_br_frame",
      orgId: ORG,
      projectId: "proj_brooks",
      folderId: "ff_br_photos",
      documentId: "doc_b1",
      name: "Addition framing",
      revisionGroupId: "grp_br_frame",
      revision: 1,
      isCurrent: 1,
      visibilityOverride: null,
      shareHistory: 0,
      byteSize: 12000,
      uploadedByName: "Maya Rivera",
      uploadedByUserId: "user_maya",
      uploadedByContactId: null,
      deletedAt: null,
      createdAt: now,
    })
    .run();
  db.insert(recordFiles)
    .values({ id: "rfile_br_frame", orgId: ORG, targetType: "inspection", targetId: "insp_br_frame", jobFileId: "jf_br_frame", createdAt: now })
    .run();
  db.insert(templatePermits)
    .values([
      { id: "tperm_bath", orgId: ORG, templateId: "tpl_bath", itemKey: "bldg", permitType: "building", jurisdiction: "" },
      { id: "tperm_kit", orgId: ORG, templateId: "tpl_kitchen", itemKey: "bldg", permitType: "building", jurisdiction: "" },
    ])
    .run();
  db.insert(templateInspections)
    .values([
      { id: "tinsp_bath_rough", orgId: ORG, templateId: "tpl_bath", itemKey: "rough", permitKey: "bldg", name: "Rough plumbing", offsetWorkdays: 4, scheduleKey: "plumb" },
      { id: "tinsp_bath_final", orgId: ORG, templateId: "tpl_bath", itemKey: "final", permitKey: "bldg", name: "Final", offsetWorkdays: 8, scheduleKey: "walk" },
      { id: "tinsp_kit_plumb", orgId: ORG, templateId: "tpl_kitchen", itemKey: "plumb", permitKey: "bldg", name: "Rough plumbing", offsetWorkdays: 4, scheduleKey: "plumb" },
      { id: "tinsp_kit_elec", orgId: ORG, templateId: "tpl_kitchen", itemKey: "elec", permitKey: "bldg", name: "Rough electrical", offsetWorkdays: 4, scheduleKey: "elec" },
      { id: "tinsp_kit_final", orgId: ORG, templateId: "tpl_kitchen", itemKey: "final", permitKey: "bldg", name: "Final", offsetWorkdays: 11, scheduleKey: "splash" },
    ])
    .run();
  db.insert(templateInspectionGates)
    .values([
      { id: "tgate_bath_tile", orgId: ORG, templateId: "tpl_bath", inspectionKey: "rough", taskKey: "tile" },
      { id: "tgate_kit_plumb", orgId: ORG, templateId: "tpl_kitchen", inspectionKey: "plumb", taskKey: "cabs" },
      { id: "tgate_kit_elec", orgId: ORG, templateId: "tpl_kitchen", inspectionKey: "elec", taskKey: "cabs" },
    ])
    .run();
}
