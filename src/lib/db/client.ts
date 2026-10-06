import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { createSqliteCompat } from "@/lib/db/pg-bridge";
import { officeClaim } from "@/lib/db/rls-context";
import { databaseTarget, resolveDataDir } from "@/lib/db/paths";
import { SEED_VERSION, seedDatabase } from "@/lib/db/seed";
import { toPostgresDdl } from "@/lib/db/sql";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

type Dialect = "sqlite" | "postgres";

type Holder = {
  db: AppDatabase;
  rls: AppDatabase | null;
  sqlite: Database.Database;
  dialect: Dialect;
  close: () => void;
};

const globalForDb = globalThis as unknown as { fieldline?: Holder };

function migrationSql(dialect: Dialect): string {
  const file = path.join(process.cwd(), "drizzle", "0000_init.sql");
  const raw = fs.readFileSync(file, "utf8");
  return dialect === "postgres" ? toPostgresDdl(raw) : raw.replace(/--> statement-breakpoint/g, "");
}

function openSqlite(file: string): Holder {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  if (file !== ":memory:") {
    // WAL needs extra files beside the database. /tmp on Vercel is happier with a single file.
    sqlite.pragma(file.startsWith("/tmp/") ? "journal_mode = DELETE" : "journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  return { db: drizzle(sqlite, { schema }), rls: null, sqlite, dialect: "sqlite", close: () => sqlite.close() };
}

function openPostgres(url: string): Holder {
  const sqlite = createSqliteCompat(url === "pglite://memory" || url.startsWith("pglite:") ? { mode: "pglite" } : { mode: "pg", url });
  const db = drizzle(sqlite as unknown as Database.Database, { schema });
  const rlsCompat = sqlite.asAuthenticated?.(() => officeClaim()?.authUserId ?? "");
  const rls = rlsCompat ? drizzle(rlsCompat as unknown as Database.Database, { schema }) : null;
  return {
    db,
    rls,
    sqlite: sqlite as unknown as Database.Database,
    dialect: "postgres",
    close: () => sqlite.close(),
  };
}

function tableExists(sqlite: Database.Database, name: string, dialect: Dialect): boolean {
  const sql =
    dialect === "postgres"
      ? "select table_name as name from information_schema.tables where table_schema = 'public' and table_name = ?"
      : "select name from sqlite_master where type = 'table' and name = ?";
  const row = sqlite.prepare(sql).get(name) as { name: string } | undefined;
  return Boolean(row);
}

function ensureAuthUserId(holder: Holder) {
  if (!tableExists(holder.sqlite, "users", holder.dialect)) return;
  const exists =
    holder.dialect === "postgres"
      ? holder.sqlite
          .prepare(
            "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'auth_user_id'",
          )
          .get()
      : (holder.sqlite.prepare("pragma table_info(users)").all() as { name: string }[]).find((column) => column.name === "auth_user_id");
  if (!exists) holder.sqlite.exec("alter table users add column auth_user_id text");
  holder.sqlite.exec("create unique index if not exists users_auth_user_id on users (auth_user_id)");
}

export function ensureReady(holder: Holder) {
  if (!tableExists(holder.sqlite, "organizations", holder.dialect)) {
    holder.sqlite.exec(migrationSql(holder.dialect));
  }
  ensureAuthUserId(holder);
  ensureSetupDismissed(holder);
  ensureOrgCalendar(holder);
  ensureTesterFeedback(holder);
  ensureTeamInvites(holder);
  ensureTimeTables(holder);
  ensureDailyLogs(holder);
  ensureSyncSchema(holder);
  ensureBills(holder);
  ensurePurchaseOrders(holder);
  ensureLineBilling(holder);
  ensureSchedule(holder);
  ensureImport(holder);
  ensureSelections(holder);
  ensureLeadForm(holder);
  const version = holder.sqlite.prepare("select value from app_meta where key = ?").get("seed_version") as
    | { value: string }
    | undefined;
  if (!version || version.value !== SEED_VERSION) {
    seedDatabase(holder.db, holder.sqlite, holder.dialect);
  }
}

export function dataDir(): string {
  return resolveDataDir();
}

export function databasePath(): string {
  const target = databaseTarget();
  if (target.kind === "postgres") return target.url;
  return target.file;
}

function openFromEnv(): Holder {
  const target = databaseTarget();
  if (target.kind === "postgres") return openPostgres(target.url);
  return openSqlite(target.file);
}

function closeHolder() {
  if (!globalForDb.fieldline) return;
  globalForDb.fieldline.close();
  globalForDb.fieldline = undefined;
}

export function getHolder(): Holder {
  if (!globalForDb.fieldline) {
    globalForDb.fieldline = openFromEnv();
    ensureReady(globalForDb.fieldline);
  }
  return globalForDb.fieldline;
}

/**
 * Owner connection (DATABASE_URL or the local SQLite file). Bypasses RLS.
 * Portal magic links, the pay page, Stripe webhooks, follow-up cron, seed, and
 * migrations stay on this connection. Office reads with a verified Supabase
 * session use officeDb() instead.
 */
export function getDb(): AppDatabase {
  return getHolder().db;
}

/** Postgres session as role `authenticated` with the verified user's JWT claims. */
export function getRlsDb(): AppDatabase {
  const holder = getHolder();
  if (!holder.rls) throw new Error("RLS reads need Postgres. The demo database has no role authenticated.");
  return holder.rls;
}

export function getSqlite(): Database.Database {
  return getHolder().sqlite;
}

/** Test helper. Reopens the singleton on a new file or :memory:. */
export function useDatabaseFile(file: string): AppDatabase {
  closeHolder();
  globalForDb.fieldline = openSqlite(file);
  ensureReady(globalForDb.fieldline);
  return globalForDb.fieldline.db;
}

/** In-memory Postgres for tests. Production uses DATABASE_URL. */
export function usePostgresMemory(): AppDatabase {
  closeHolder();
  globalForDb.fieldline = openPostgres("pglite://memory");
  ensureReady(globalForDb.fieldline);
  return globalForDb.fieldline.db;
}

function ensureSetupDismissed(holder: Holder) {
  if (!tableExists(holder.sqlite, "organizations", holder.dialect)) return;
  const exists =
    holder.dialect === "postgres"
      ? holder.sqlite
          .prepare(
            "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'setup_dismissed_at'",
          )
          .get()
      : (holder.sqlite.prepare("pragma table_info(organizations)").all() as { name: string }[]).find(
          (column) => column.name === "setup_dismissed_at",
        );
  if (!exists) holder.sqlite.exec("alter table organizations add column setup_dismissed_at text");
}

function ensureOrgCalendar(holder: Holder) {
  if (!tableExists(holder.sqlite, "organizations", holder.dialect)) return;
  if (!orgColumn(holder, "time_zone")) {
    holder.sqlite.exec("alter table organizations add column time_zone text not null default 'America/New_York'");
  }
  if (!orgColumn(holder, "week_starts_on")) {
    holder.sqlite.exec("alter table organizations add column week_starts_on integer not null default 1");
  }
}

function orgColumn(holder: Holder, column: string): boolean {
  if (holder.dialect === "postgres") {
    return Boolean(
      holder.sqlite
        .prepare(
          "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = ?",
        )
        .get(column),
    );
  }
  return (holder.sqlite.prepare("pragma table_info(organizations)").all() as { name: string }[]).some((row) => row.name === column);
}

function ensureTeamInvites(holder: Holder) {
  if (tableExists(holder.sqlite, "team_invites", holder.dialect)) return;
  const ddl =
    holder.dialect === "postgres"
      ? `create table if not exists team_invites (
          id text primary key,
          org_id text not null,
          email text not null,
          role text not null,
          token_hash text not null,
          status text not null,
          invited_by text not null,
          expires_at text not null,
          accepted_by text,
          accepted_at text,
          revoked_at text,
          created_at text not null
        );
        create unique index if not exists team_invites_token_hash on team_invites (token_hash);
        create index if not exists team_invites_org on team_invites (org_id);`
      : `create table if not exists team_invites (
          id text primary key not null,
          org_id text not null,
          email text not null,
          role text not null,
          token_hash text not null,
          status text not null,
          invited_by text not null,
          expires_at text not null,
          accepted_by text,
          accepted_at text,
          revoked_at text,
          created_at text not null
        );
        create unique index if not exists team_invites_token_hash on team_invites (token_hash);
        create index if not exists team_invites_org on team_invites (org_id);`;
  holder.sqlite.exec(ddl);
}

function ensureTimeTables(holder: Holder) {
  if (tableExists(holder.sqlite, "time_entries", holder.dialect)) return;
  const ddl =
    holder.dialect === "postgres"
      ? `create table if not exists labor_rates (
          id text primary key,
          org_id text not null,
          user_id text not null,
          hourly_cost_cents integer not null,
          updated_at text not null,
          updated_by text
        );
        create unique index if not exists labor_rates_org_user on labor_rates (org_id, user_id);
        create index if not exists labor_rates_org on labor_rates (org_id);
        create table if not exists time_entries (
          id text primary key,
          org_id text not null,
          user_id text not null,
          project_id text not null,
          cost_code text not null,
          status text not null,
          clock_in_at text not null,
          clock_out_at text,
          break_minutes integer not null default 0,
          break_started_at text,
          note text,
          clock_in_lat_e6 integer,
          clock_in_lng_e6 integer,
          clock_out_lat_e6 integer,
          clock_out_lng_e6 integer,
          source text not null,
          client_event_id text,
          synced_at text,
          anomaly text,
          created_at text not null,
          updated_at text not null,
          created_by text
        );
        create index if not exists time_entries_org on time_entries (org_id);
        create index if not exists time_entries_user on time_entries (org_id, user_id);
        create unique index if not exists time_entries_client_event on time_entries (client_event_id);
        create table if not exists time_entry_events (
          id text primary key,
          org_id text not null,
          entry_id text not null,
          actor_id text,
          type text not null,
          reason text,
          before_json text,
          after_json text,
          created_at text not null
        );
        create index if not exists time_entry_events_entry on time_entry_events (org_id, entry_id);
        create table if not exists time_approvals (
          id text primary key,
          org_id text not null,
          entry_id text not null,
          rate_cents integer not null,
          minutes integer not null,
          amount_cents integer not null,
          cost_item_id text,
          status text not null,
          reason text,
          created_at text not null,
          created_by text
        );
        create index if not exists time_approvals_entry on time_approvals (org_id, entry_id);`
      : `create table if not exists labor_rates (
          id text primary key not null,
          org_id text not null,
          user_id text not null,
          hourly_cost_cents integer not null,
          updated_at text not null,
          updated_by text
        );
        create unique index if not exists labor_rates_org_user on labor_rates (org_id, user_id);
        create index if not exists labor_rates_org on labor_rates (org_id);
        create table if not exists time_entries (
          id text primary key not null,
          org_id text not null,
          user_id text not null,
          project_id text not null,
          cost_code text not null,
          status text not null,
          clock_in_at text not null,
          clock_out_at text,
          break_minutes integer not null default 0,
          break_started_at text,
          note text,
          clock_in_lat_e6 integer,
          clock_in_lng_e6 integer,
          clock_out_lat_e6 integer,
          clock_out_lng_e6 integer,
          source text not null,
          client_event_id text,
          synced_at text,
          anomaly text,
          created_at text not null,
          updated_at text not null,
          created_by text
        );
        create index if not exists time_entries_org on time_entries (org_id);
        create index if not exists time_entries_user on time_entries (org_id, user_id);
        create unique index if not exists time_entries_client_event on time_entries (client_event_id);
        create table if not exists time_entry_events (
          id text primary key not null,
          org_id text not null,
          entry_id text not null,
          actor_id text,
          type text not null,
          reason text,
          before_json text,
          after_json text,
          created_at text not null
        );
        create index if not exists time_entry_events_entry on time_entry_events (org_id, entry_id);
        create table if not exists time_approvals (
          id text primary key not null,
          org_id text not null,
          entry_id text not null,
          rate_cents integer not null,
          minutes integer not null,
          amount_cents integer not null,
          cost_item_id text,
          status text not null,
          reason text,
          created_at text not null,
          created_by text
        );
        create index if not exists time_approvals_entry on time_approvals (org_id, entry_id);`;
  holder.sqlite.exec(ddl);
}

function ensureDailyLogs(holder: Holder) {
  if (tableExists(holder.sqlite, "daily_logs", holder.dialect)) return;
  const ddl =
    holder.dialect === "postgres"
      ? `create table if not exists daily_logs (
          id text primary key,
          org_id text not null,
          project_id text not null,
          author_id text not null,
          log_date text not null,
          status text not null,
          visibility text not null,
          notes text,
          planned_next text,
          weather_sky text,
          weather_high_f integer,
          weather_low_f integer,
          weather_lost_minutes integer,
          weather_impact text,
          delay_cause text,
          delay_minutes integer,
          deliveries text,
          visitors text,
          safety_note text,
          published_at text,
          void_reason text,
          created_at text not null,
          updated_at text not null
        );
        create unique index if not exists daily_logs_one_open on daily_logs (org_id, project_id, author_id, log_date) where status <> 'void';
        create index if not exists daily_logs_project on daily_logs (org_id, project_id, log_date);
        create table if not exists daily_log_events (
          id text primary key,
          org_id text not null,
          log_id text not null,
          actor_id text,
          type text not null,
          reason text,
          before_json text,
          after_json text,
          created_at text not null
        );
        create index if not exists daily_log_events_log on daily_log_events (org_id, log_id);
        create table if not exists daily_log_photos (
          id text primary key,
          org_id text not null,
          log_id text not null,
          document_id text not null,
          created_at text not null
        );
        create index if not exists daily_log_photos_log on daily_log_photos (org_id, log_id);`
      : `create table if not exists daily_logs (
          id text primary key not null,
          org_id text not null,
          project_id text not null,
          author_id text not null,
          log_date text not null,
          status text not null,
          visibility text not null,
          notes text,
          planned_next text,
          weather_sky text,
          weather_high_f integer,
          weather_low_f integer,
          weather_lost_minutes integer,
          weather_impact text,
          delay_cause text,
          delay_minutes integer,
          deliveries text,
          visitors text,
          safety_note text,
          published_at text,
          void_reason text,
          created_at text not null,
          updated_at text not null
        );
        create unique index if not exists daily_logs_one_open on daily_logs (org_id, project_id, author_id, log_date) where status <> 'void';
        create index if not exists daily_logs_project on daily_logs (org_id, project_id, log_date);
        create table if not exists daily_log_events (
          id text primary key not null,
          org_id text not null,
          log_id text not null,
          actor_id text,
          type text not null,
          reason text,
          before_json text,
          after_json text,
          created_at text not null
        );
        create index if not exists daily_log_events_log on daily_log_events (org_id, log_id);
        create table if not exists daily_log_photos (
          id text primary key not null,
          org_id text not null,
          log_id text not null,
          document_id text not null,
          created_at text not null
        );
        create index if not exists daily_log_photos_log on daily_log_photos (org_id, log_id);`;
  holder.sqlite.exec(ddl);
}

function ensureLineBilling(holder: Holder) {
  if (!tableExists(holder.sqlite, "line_items", holder.dialect)) return;
  if (!tableColumn(holder, "line_items", "billing")) {
    holder.sqlite.exec("alter table line_items add column billing text not null default 'included'");
  }
}

function tableColumn(holder: Holder, table: string, column: string): boolean {
  if (holder.dialect === "postgres") {
    return Boolean(
      holder.sqlite
        .prepare(
          "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = ? and column_name = ?",
        )
        .get(table, column),
    );
  }
  return (holder.sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some((row) => row.name === column);
}

function ensureSyncSchema(holder: Holder) {
  if (!tableExists(holder.sqlite, "time_entries", holder.dialect)) return;
  if (!tableColumn(holder, "time_entries", "client_event_id")) {
    holder.sqlite.exec("alter table time_entries add column client_event_id text");
  }
  if (!tableColumn(holder, "time_entries", "synced_at")) {
    holder.sqlite.exec("alter table time_entries add column synced_at text");
  }
  if (!tableColumn(holder, "time_entries", "anomaly")) {
    holder.sqlite.exec("alter table time_entries add column anomaly text");
  }
  holder.sqlite.exec("drop index if exists time_entries_client_event");
  holder.sqlite.exec("create unique index if not exists time_entries_client_event on time_entries (org_id, user_id, client_event_id)");
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "sync_events", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists sync_events (
      id ${pk},
      client_event_id text not null,
      org_id text not null,
      user_id text not null,
      kind text not null,
      captured_at text not null,
      status text not null,
      result_json text not null,
      created_at text not null
    )`);
  } else if (!tableColumn(holder, "sync_events", "id")) {
    holder.sqlite.exec(`create table sync_events_next (
      id ${pk},
      client_event_id text not null,
      org_id text not null,
      user_id text not null,
      kind text not null,
      captured_at text not null,
      status text not null,
      result_json text not null,
      created_at text not null
    )`);
    holder.sqlite.exec(`insert into sync_events_next (id, client_event_id, org_id, user_id, kind, captured_at, status, result_json, created_at)
      select client_event_id, client_event_id, org_id, user_id, kind, captured_at, status, result_json, created_at from sync_events`);
    holder.sqlite.exec("drop table sync_events");
    holder.sqlite.exec("alter table sync_events_next rename to sync_events");
  }
  holder.sqlite.exec("create unique index if not exists sync_events_scope on sync_events (org_id, user_id, client_event_id)");
  holder.sqlite.exec("create index if not exists sync_events_org_user on sync_events (org_id, user_id)");
  if (!tableExists(holder.sqlite, "time_anomalies", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists time_anomalies (
      id ${pk},
      org_id text not null,
      user_id text not null,
      client_event_id text not null,
      kind text not null,
      detail text not null,
      captured_at text not null,
      project_id text,
      cost_code text,
      entry_id text,
      log_id text,
      resolved_at text,
      created_at text not null
    )`);
    holder.sqlite.exec("create index if not exists time_anomalies_org on time_anomalies (org_id)");
  }
  holder.sqlite.exec("drop index if exists time_anomalies_event");
  holder.sqlite.exec("create unique index if not exists time_anomalies_event on time_anomalies (org_id, user_id, client_event_id)");
}

function ensureBills(holder: Holder) {
  if (!tableExists(holder.sqlite, "bills", holder.dialect)) return;
  const adds: [string, string][] = [
    ["bill_number", "text not null default ''"],
    ["bill_date", "text"],
    ["void_reason", "text"],
    ["paid_at", "text"],
    ["pay_method", "text"],
    ["pay_reference", "text"],
    ["document_id", "text"],
    ["approved_at", "text"],
    ["low_confidence", "integer not null default 0"],
  ];
  for (const [column, type] of adds) {
    if (!tableColumn(holder, "bills", column)) holder.sqlite.exec(`alter table bills add column ${column} ${type}`);
  }
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "bill_lines", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bill_lines (
      id ${pk},
      org_id text not null,
      bill_id text not null,
      cost_code text not null,
      description text,
      amount_cents integer not null,
      cost_item_id text,
      sort_order integer not null default 0
    )`);
  }
  if (!tableExists(holder.sqlite, "bill_events", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bill_events (
      id ${pk},
      org_id text not null,
      bill_id text not null,
      actor_id text,
      type text not null,
      reason text,
      before_json text,
      after_json text,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists bills_org on bills (org_id)");
  holder.sqlite.exec("create index if not exists bills_vendor on bills (org_id, vendor_contact_id)");
  holder.sqlite.exec("create index if not exists bill_lines_bill on bill_lines (org_id, bill_id)");
  holder.sqlite.exec("create index if not exists bill_events_bill on bill_events (org_id, bill_id)");
  holder.sqlite.exec(
    "create unique index if not exists bills_vendor_number on bills (org_id, vendor_contact_id, bill_number) where status != 'void' and bill_number != ''",
  );
}

function ensurePurchaseOrders(holder: Holder) {
  if (tableExists(holder.sqlite, "bills", holder.dialect) && !tableColumn(holder, "bills", "purchase_order_id")) {
    holder.sqlite.exec("alter table bills add column purchase_order_id text");
  }
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "purchase_orders", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists purchase_orders (
      id ${pk},
      org_id text not null,
      project_id text not null,
      vendor_contact_id text not null,
      change_order_id text,
      number text not null,
      scope text,
      status text not null,
      void_reason text,
      issued_at text,
      closed_at text,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  if (!tableExists(holder.sqlite, "purchase_order_lines", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists purchase_order_lines (
      id ${pk},
      org_id text not null,
      purchase_order_id text not null,
      cost_code text not null,
      description text,
      amount_cents integer not null,
      sort_order integer not null default 0
    )`);
  }
  if (!tableExists(holder.sqlite, "purchase_order_events", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists purchase_order_events (
      id ${pk},
      org_id text not null,
      purchase_order_id text not null,
      actor_id text,
      type text not null,
      reason text,
      before_json text,
      after_json text,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists purchase_orders_number on purchase_orders (org_id, number)");
  holder.sqlite.exec("create index if not exists purchase_orders_org on purchase_orders (org_id)");
  holder.sqlite.exec("create index if not exists purchase_order_lines_po on purchase_order_lines (org_id, purchase_order_id)");
  holder.sqlite.exec("create index if not exists purchase_order_events_po on purchase_order_events (org_id, purchase_order_id)");
  if (tableExists(holder.sqlite, "bills", holder.dialect)) {
    holder.sqlite.exec("create index if not exists bills_po on bills (org_id, purchase_order_id)");
  }
}

function ensureSchedule(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "schedule_items", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists schedule_items (
      id ${pk},
      org_id text not null,
      project_id text not null,
      title text not null,
      start_date text not null,
      end_date text not null,
      start_time text,
      status text not null,
      note text,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  if (!tableExists(holder.sqlite, "schedule_assignees", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists schedule_assignees (
      id ${pk},
      org_id text not null,
      item_id text not null,
      user_id text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "calendar_feeds", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists calendar_feeds (
      id ${pk},
      org_id text not null,
      user_id text not null,
      token_hash text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists schedule_items_org on schedule_items (org_id, start_date)");
  holder.sqlite.exec("create unique index if not exists schedule_assignees_slot on schedule_assignees (org_id, item_id, user_id)");
  holder.sqlite.exec("create index if not exists schedule_assignees_user on schedule_assignees (org_id, user_id)");
  holder.sqlite.exec("create unique index if not exists calendar_feeds_user on calendar_feeds (org_id, user_id)");
  holder.sqlite.exec("create unique index if not exists calendar_feeds_hash on calendar_feeds (token_hash)");
}

function ensureImport(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "import_batches", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists import_batches (
      id ${pk},
      org_id text not null,
      kind text not null,
      created_by text,
      created_at text not null,
      undone_at text,
      summary_json text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "import_rows", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists import_rows (
      id ${pk},
      org_id text not null,
      batch_id text not null,
      row_index integer not null,
      action text not null,
      record_kind text not null,
      record_id text,
      before_json text,
      after_json text,
      undone_at text,
      undo_block text
    )`);
  }
  holder.sqlite.exec("create index if not exists import_batches_org on import_batches (org_id, created_at)");
  holder.sqlite.exec("create index if not exists import_rows_batch on import_rows (org_id, batch_id)");
}

function ensureSelections(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "selections", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists selections (
      id ${pk},
      org_id text not null,
      project_id text not null,
      title text not null,
      area text,
      due_date text,
      status text not null,
      allowance_budget_line_id text,
      qty_milli integer not null default 1000,
      chosen_choice_id text,
      cost_item_id text,
      change_order_id text,
      created_by text,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "selection_choices", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists selection_choices (
      id ${pk},
      org_id text not null,
      selection_id text not null,
      name text not null,
      vendor text,
      sku text,
      link text,
      photo_document_id text,
      unit_price_cents integer not null,
      unit_cost_cents integer not null,
      note text,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "selection_events", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists selection_events (
      id ${pk},
      org_id text not null,
      selection_id text not null,
      actor_id text,
      action text not null,
      reason text,
      before_json text,
      after_json text,
      signer_name text,
      ip text,
      user_agent text,
      doc_hash text,
      consent_text_version text,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists selections_org on selections (org_id, project_id)");
  holder.sqlite.exec("create index if not exists selection_choices_selection on selection_choices (org_id, selection_id)");
  holder.sqlite.exec("create index if not exists selection_events_selection on selection_events (org_id, selection_id)");
}

function ensureLeadForm(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "lead_forms", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists lead_forms (
      id ${pk},
      org_id text not null,
      enabled integer not null default 0,
      token text not null,
      intro text not null default '',
      thanks text not null,
      fields_json text not null,
      project_types_json text not null,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "lead_form_submissions", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists lead_form_submissions (
      id ${pk},
      org_id text not null,
      form_id text not null,
      lead_id text not null,
      contact_id text not null,
      answers_json text not null,
      attribution text,
      seen_at text,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "lead_form_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists lead_form_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists lead_forms_org on lead_forms (org_id)");
  holder.sqlite.exec("create unique index if not exists lead_forms_token on lead_forms (token)");
  holder.sqlite.exec("create index if not exists lead_form_submissions_org on lead_form_submissions (org_id, seen_at)");
  holder.sqlite.exec("create index if not exists lead_form_submissions_lead on lead_form_submissions (org_id, lead_id)");
  holder.sqlite.exec("create index if not exists lead_form_attempts_org on lead_form_attempts (org_id, created_at)");
}

function ensureTesterFeedback(holder: Holder) {
  if (tableExists(holder.sqlite, "tester_feedback", holder.dialect)) return;
  const ddl =
    holder.dialect === "postgres"
      ? `create table if not exists tester_feedback (
          id text primary key,
          org_id text not null,
          user_id text not null,
          path text not null,
          body text not null,
          context text,
          user_agent text,
          created_at text not null
        );
        create index if not exists tester_feedback_org on tester_feedback (org_id);`
      : `create table if not exists tester_feedback (
          id text primary key not null,
          org_id text not null,
          user_id text not null,
          path text not null,
          body text not null,
          context text,
          user_agent text,
          created_at text not null
        );
        create index if not exists tester_feedback_org on tester_feedback (org_id);`;
  holder.sqlite.exec(ddl);
}

export function resetDatabase(): AppDatabase {
  const target = databaseTarget();
  closeHolder();
  if (target.kind === "sqlite" && target.file !== ":memory:") {
    const files = [target.file, `${target.file}-wal`, `${target.file}-shm`];
    for (const file of files) {
      if (fs.existsSync(/*turbopackIgnore: true*/ file)) fs.rmSync(/*turbopackIgnore: true*/ file);
    }
  }
  return getDb();
}
