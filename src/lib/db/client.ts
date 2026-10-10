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
  ensurePunch(holder);
  ensureVendorPortal(holder);
  ensureBids(holder);
  ensureDraws(holder);
  ensureRfis(holder);
  ensureComments(holder);
  ensureWorkdays(holder);
  ensureScheduleLinks(holder);
  ensureTemplates(holder);
  ensureWip(holder);
  ensureTodos(holder);
  ensureSavedViews(holder);
  ensureSubmittals(holder);
  ensureLienWaivers(holder);
  ensureJobFiles(holder);
  ensureRetainage(holder);
  ensureMeasurements(holder);
  ensureAssemblies(holder);
  ensureClientUpdates(holder);
  ensureCostPlus(holder);
  ensureSchedulePlan(holder);
  ensurePermits(holder);
  ensureMarkup(holder);
  ensureEquipment(holder);
  ensureAutomations(holder);
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

function ensureWorkdays(holder: Holder) {
  if (!tableExists(holder.sqlite, "organizations", holder.dialect)) return;
  if (!orgColumn(holder, "workdays_mask")) {
    holder.sqlite.exec("alter table organizations add column workdays_mask integer not null default 62");
  }
  if (!tableExists(holder.sqlite, "projects", holder.dialect)) return;
  for (const column of ["template_id", "template_name", "pm_user_id"]) {
    if (!tableColumn(holder, "projects", column)) holder.sqlite.exec(`alter table projects add column ${column} text`);
  }
  if (!tableColumn(holder, "projects", "template_version")) holder.sqlite.exec("alter table projects add column template_version integer");
}

function ensureScheduleLinks(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "schedule_links", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists schedule_links (
      id ${pk},
      org_id text not null,
      project_id text not null,
      item_id text not null,
      predecessor_id text not null,
      lag_workdays integer not null default 0
    )`);
  }
  holder.sqlite.exec("create unique index if not exists schedule_links_edge on schedule_links (org_id, item_id, predecessor_id)");
  holder.sqlite.exec("create index if not exists schedule_links_project on schedule_links (org_id, project_id)");
}

function ensureWip(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "wip_overrides", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists wip_overrides (
      id ${pk},
      org_id text not null,
      project_id text not null,
      amount_cents integer not null,
      note text not null,
      updated_at text not null,
      updated_by text
    )`);
  }
  holder.sqlite.exec("create unique index if not exists wip_overrides_project on wip_overrides (org_id, project_id)");
  if (!tableExists(holder.sqlite, "wip_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists wip_attempts (
      id ${pk},
      org_id text not null,
      user_id text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists wip_attempts_user on wip_attempts (org_id, user_id, created_at)");
}

function ensureTodos(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  const add = (column: string, ddl: string) => {
    if (!tableColumn(holder, "tasks", column)) holder.sqlite.exec(`alter table tasks add column ${ddl}`);
  };
  add("notes", "notes text not null default ''");
  add("priority", "priority text not null default 'normal'");
  add("tags", "tags text not null default ''");
  add("schedule_item_id", "schedule_item_id text");
  add("deadline_edge", "deadline_edge text");
  add("deadline_offset", "deadline_offset integer");
  add("deadline_unlinked", "deadline_unlinked integer not null default 0");
  add("remind_days", "remind_days integer");
  add("reminded_for", "reminded_for text");
  const table = (name: string, body: string, indexSql: string) => {
    if (!tableExists(holder.sqlite, name, holder.dialect)) holder.sqlite.exec(`create table if not exists ${name} (id ${pk}, ${body})`);
    holder.sqlite.exec(indexSql);
  };
  table("task_assignees", "org_id text not null, task_id text not null, user_id text, contact_id text", "create index if not exists task_assignees_task on task_assignees (org_id, task_id)");
  table(
    "task_checks",
    "org_id text not null, task_id text not null, title text not null, sort_order integer not null, status text not null, assignee_user_id text, assignee_contact_id text, due_at text, completed_at text, completed_by text",
    "create index if not exists task_checks_task on task_checks (org_id, task_id)",
  );
  table(
    "task_files",
    "org_id text not null, task_id text not null, check_id text, document_id text not null",
    "create index if not exists task_files_task on task_files (org_id, task_id)",
  );
  table(
    "todo_attempts",
    "org_id text not null, user_id text not null, created_at text not null",
    "create index if not exists todo_attempts_user on todo_attempts (org_id, user_id, created_at)",
  );
  table(
    "template_todos",
    "org_id text not null, template_id text not null, title text not null, notes text not null default '', priority text not null default 'normal', tags text not null default '', remind_days integer, schedule_key text, deadline_edge text, deadline_offset integer, sort_order integer not null",
    "create index if not exists template_todos_template on template_todos (org_id, template_id)",
  );
  table(
    "template_todo_checks",
    "org_id text not null, template_id text not null, todo_id text not null, title text not null, sort_order integer not null",
    "create index if not exists template_todo_checks_todo on template_todo_checks (org_id, todo_id)",
  );
}

function ensureSavedViews(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "saved_views", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists saved_views (
      id ${pk},
      org_id text not null,
      user_id text not null,
      list_key text not null,
      name text not null,
      query_json text not null,
      sort_key text,
      sort_dir text,
      shared integer not null default 0,
      created_at text not null,
      updated_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists saved_views_org_list on saved_views (org_id, list_key)");
  if (!tableExists(holder.sqlite, "saved_view_pins", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists saved_view_pins (
      id ${pk},
      org_id text not null,
      user_id text not null,
      list_key text not null,
      view_id text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists saved_view_pins_user_list on saved_view_pins (org_id, user_id, list_key)");
}

function ensureTemplates(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "job_templates", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists job_templates (
      id ${pk},
      org_id text not null,
      name text not null,
      job_type text not null,
      version integer not null,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  if (!tableExists(holder.sqlite, "template_tasks", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_tasks (
      id ${pk},
      org_id text not null,
      template_id text not null,
      item_key text not null,
      title text not null,
      phase text,
      start_offset integer not null,
      duration_workdays integer not null,
      trade text,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "template_task_links", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_task_links (
      id ${pk},
      org_id text not null,
      template_id text not null,
      item_key text not null,
      predecessor_key text not null,
      lag_workdays integer not null default 0
    )`);
  }
  if (!tableExists(holder.sqlite, "template_lines", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_lines (
      id ${pk},
      org_id text not null,
      template_id text not null,
      name text not null,
      cost_code text,
      qty_milli integer not null,
      unit text not null,
      unit_cost_cents integer not null,
      unit_price_cents integer not null,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "template_draws", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_draws (
      id ${pk},
      org_id text not null,
      template_id text not null,
      title text not null,
      bps integer not null,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "template_selections", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_selections (
      id ${pk},
      org_id text not null,
      template_id text not null,
      title text not null,
      area text,
      allowance_cents integer not null,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "template_checks", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_checks (
      id ${pk},
      org_id text not null,
      template_id text not null,
      title text not null,
      kind text not null,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "template_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_attempts (
      id ${pk},
      org_id text not null,
      user_id text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists job_templates_org on job_templates (org_id, name)");
  holder.sqlite.exec("create index if not exists template_tasks_template on template_tasks (org_id, template_id)");
  holder.sqlite.exec("create index if not exists template_task_links_template on template_task_links (org_id, template_id)");
  holder.sqlite.exec("create index if not exists template_lines_template on template_lines (org_id, template_id)");
  holder.sqlite.exec("create index if not exists template_draws_template on template_draws (org_id, template_id)");
  holder.sqlite.exec("create index if not exists template_selections_template on template_selections (org_id, template_id)");
  holder.sqlite.exec("create index if not exists template_checks_template on template_checks (org_id, template_id)");
  holder.sqlite.exec("create index if not exists template_attempts_user on template_attempts (org_id, user_id, created_at)");
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

function columnExists(holder: Holder, table: string, column: string): boolean {
  if (holder.dialect === "postgres") {
    const row = holder.sqlite
      .prepare(
        "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = ? and column_name = ?",
      )
      .get(table, column);
    return Boolean(row);
  }
  return (holder.sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some((entry) => entry.name === column);
}

function ensureMeasurements(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "line_items", "qty_formula", "text");
  ensureColumn(holder, "line_items", "waste_bps", "integer not null default 0");
  ensureColumn(holder, "line_items", "round_to_milli", "integer");
  ensureColumn(holder, "price_book_items", "default_formula", "text");
  ensureColumn(holder, "price_book_items", "default_waste_bps", "integer");
  ensureColumn(holder, "price_book_items", "default_round_to_milli", "integer");
  ensureColumn(holder, "template_lines", "qty_formula", "text");
  ensureColumn(holder, "template_lines", "waste_bps", "integer not null default 0");
  ensureColumn(holder, "template_lines", "round_to_milli", "integer");
  if (!tableExists(holder.sqlite, "estimate_measurements", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists estimate_measurements (
      id ${pk},
      org_id text not null,
      estimate_id text not null,
      name text not null,
      value_milli integer not null,
      unit text not null,
      sort_order integer not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists estimate_measurements_name on estimate_measurements (org_id, estimate_id, name)");
  holder.sqlite.exec("create index if not exists estimate_measurements_estimate on estimate_measurements (org_id, estimate_id)");
}

function ensureAssemblies(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "line_items", "group_id", "text");
  ensureColumn(holder, "line_items", "qty_overridden", "integer not null default 0");
  if (!tableExists(holder.sqlite, "assemblies", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists assemblies (
      id ${pk},
      org_id text not null,
      name text not null,
      drive text not null,
      archived_at text,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists assemblies_org on assemblies (org_id)");
  if (!tableExists(holder.sqlite, "assembly_parts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists assembly_parts (
      id ${pk},
      org_id text not null,
      assembly_id text not null,
      name text not null,
      price_book_item_id text,
      cost_code text,
      unit text not null,
      unit_cost_cents integer not null,
      formula text not null,
      waste_bps integer not null default 0,
      round_to_milli integer,
      sort_order integer not null
    )`);
  }
  holder.sqlite.exec("create index if not exists assembly_parts_assembly on assembly_parts (org_id, assembly_id)");
  if (!tableExists(holder.sqlite, "estimate_groups", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists estimate_groups (
      id ${pk},
      org_id text not null,
      estimate_id text not null,
      section_id text not null,
      assembly_id text,
      name text not null,
      measurement_id text not null,
      present_as text not null default 'one',
      sort_order integer not null
    )`);
  }
  holder.sqlite.exec("create index if not exists estimate_groups_estimate on estimate_groups (org_id, estimate_id)");
}

function ensureCostPlus(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "projects", "markup_bps", "integer not null default 0");
  ensureColumn(holder, "projects", "tax_bps", "integer not null default 0");
  ensureColumn(holder, "labor_rates", "hourly_bill_cents", "integer");
  ensureColumn(holder, "invoices", "present_as", "text not null default 'grouped'");
  ensureColumn(holder, "invoices", "markup_display", "text not null default 'baked'");
  if (!tableExists(holder.sqlite, "cost_code_markups", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists cost_code_markups (
      id ${pk},
      org_id text not null,
      project_id text not null,
      cost_code text not null,
      markup_bps integer not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists cost_code_markups_code on cost_code_markups (org_id, project_id, cost_code)");
  if (!tableExists(holder.sqlite, "invoice_costs", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists invoice_costs (
      id ${pk},
      org_id text not null,
      project_id text not null,
      invoice_id text,
      source_kind text not null,
      source_id text not null,
      cost_code text not null,
      label text not null,
      occurred_on text not null,
      cost_cents integer not null,
      markup_bps integer not null,
      markup_cents integer not null,
      price_cents integer not null,
      non_billable integer not null default 0,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists invoice_costs_source on invoice_costs (org_id, source_kind, source_id)");
  holder.sqlite.exec("create index if not exists invoice_costs_invoice on invoice_costs (org_id, invoice_id)");
}

function ensureClientUpdates(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "client_updates", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists client_updates (
      id ${pk},
      org_id text not null,
      project_id text not null,
      range_start text not null,
      range_end text not null,
      status text not null,
      body text not null,
      sources_json text not null,
      photo_ids_json text not null,
      published_at text,
      viewed_at text,
      unpublished_at text,
      unpublish_reason text,
      version integer not null default 1,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists client_updates_project on client_updates (org_id, project_id)");
  if (!tableExists(holder.sqlite, "client_update_versions", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists client_update_versions (
      id ${pk},
      org_id text not null,
      update_id text not null,
      version integer not null,
      body text not null,
      sources_json text not null,
      photo_ids_json text not null,
      created_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists client_update_versions_update on client_update_versions (org_id, update_id)");
}

function ensureRetainage(holder: Holder) {
  ensureColumn(holder, "organizations", "vendor_retainage_bps", "integer not null default 0");
  ensureColumn(holder, "contacts", "retainage_bps", "integer");
  ensureColumn(holder, "purchase_orders", "retainage_bps", "integer not null default 0");
  ensureColumn(holder, "bills", "retainage_cents", "integer not null default 0");
  ensureColumn(holder, "bills", "kind", "text not null default 'standard'");
}

function ensureColumn(holder: Holder, table: string, column: string, type: string) {
  if (!tableExists(holder.sqlite, table, holder.dialect)) return;
  if (!columnExists(holder, table, column)) holder.sqlite.exec(`alter table ${table} add column ${column} ${type}`);
}

function ensurePunch(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "organizations", "warranty_months", "integer not null default 12");
  ensureColumn(holder, "projects", "substantial_at", "text");
  ensureColumn(holder, "projects", "closed_at", "text");
  ensureColumn(holder, "projects", "warranty_ends_on", "text");
  ensureColumn(holder, "projects", "warranty_months", "integer");
  ensureColumn(holder, "projects", "close_override_reason", "text");
  if (!tableExists(holder.sqlite, "punch_items", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists punch_items (
      id ${pk},
      org_id text not null,
      project_id text not null,
      title text not null,
      location text,
      cost_code text,
      assignee_user_id text,
      assignee_contact_id text,
      due_date text,
      status text not null,
      shared integer not null default 0,
      before_document_id text,
      after_document_id text,
      done_at text,
      verified_at text,
      created_by text,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "warranty_requests", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists warranty_requests (
      id ${pk},
      org_id text not null,
      project_id text not null,
      title text not null,
      description text,
      urgency text not null,
      status text not null,
      visit_date text,
      schedule_item_id text,
      assignee_user_id text,
      cost_code text,
      cost_item_id text,
      client_note text,
      internal_note text,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "warranty_photos", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists warranty_photos (
      id ${pk},
      org_id text not null,
      request_id text not null,
      document_id text not null,
      sort_order integer not null
    )`);
  }
  if (!tableExists(holder.sqlite, "warranty_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists warranty_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists punch_items_org on punch_items (org_id, project_id)");
  holder.sqlite.exec("create index if not exists warranty_requests_org on warranty_requests (org_id, project_id, status)");
  holder.sqlite.exec("create index if not exists warranty_photos_request on warranty_photos (org_id, request_id)");
  holder.sqlite.exec("create index if not exists warranty_attempts_org on warranty_attempts (org_id, created_at)");
}

function ensureVendorPortal(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "organizations", "vendor_compliance_mode", "text not null default 'warn'");
  ensureColumn(holder, "organizations", "vendor_required_types", "text not null default 'general_liability,workers_comp'");
  ensureColumn(holder, "purchase_orders", "accepted_at", "text");
  ensureColumn(holder, "purchase_orders", "accepted_name", "text");
  ensureColumn(holder, "purchase_orders", "declined_at", "text");
  ensureColumn(holder, "purchase_orders", "decline_reason", "text");
  ensureColumn(holder, "bills", "portal_submitted", "integer not null default 0");
  ensureColumn(holder, "schedule_items", "vendor_contact_id", "text");
  if (!tableExists(holder.sqlite, "vendor_portals", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists vendor_portals (
      id ${pk},
      org_id text not null,
      contact_id text not null,
      token_hash text not null,
      created_at text not null,
      rotated_at text
    )`);
  }
  if (!tableExists(holder.sqlite, "vendor_certificates", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists vendor_certificates (
      id ${pk},
      org_id text not null,
      contact_id text not null,
      type text not null,
      expires_on text not null,
      document_id text,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "vendor_portal_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists vendor_portal_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists vendor_portals_contact on vendor_portals (org_id, contact_id)");
  holder.sqlite.exec("create unique index if not exists vendor_portals_hash on vendor_portals (token_hash)");
  holder.sqlite.exec("create unique index if not exists vendor_certificates_type on vendor_certificates (org_id, contact_id, type)");
  holder.sqlite.exec("create index if not exists vendor_certificates_org on vendor_certificates (org_id, contact_id)");
  holder.sqlite.exec("create index if not exists vendor_portal_attempts_org on vendor_portal_attempts (org_id, created_at)");
}

function ensureBids(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "bid_requests", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bid_requests (
      id ${pk},
      org_id text not null,
      project_id text not null,
      title text not null,
      scope text,
      due_on text not null,
      status text not null,
      created_at text not null,
      updated_at text not null,
      created_by text,
      awarded_at text,
      closed_at text
    )`);
  }
  if (!tableExists(holder.sqlite, "bid_lines", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bid_lines (
      id ${pk},
      org_id text not null,
      bid_id text not null,
      cost_code text not null,
      description text not null,
      qty_milli integer not null,
      unit text not null,
      budget_line_id text,
      sort_order integer not null default 0
    )`);
  }
  if (!tableExists(holder.sqlite, "bid_files", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bid_files (
      id ${pk},
      org_id text not null,
      bid_id text not null,
      document_id text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "bid_invites", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bid_invites (
      id ${pk},
      org_id text not null,
      bid_id text not null,
      contact_id text not null,
      status text not null,
      note text,
      submitted_name text,
      submitted_at text,
      declined_at text,
      decline_reason text,
      document_id text
    )`);
  }
  if (!tableExists(holder.sqlite, "bid_prices", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bid_prices (
      id ${pk},
      org_id text not null,
      invite_id text not null,
      bid_line_id text not null,
      unit_price_cents integer,
      no_bid integer not null default 0
    )`);
  }
  if (!tableExists(holder.sqlite, "bid_awards", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists bid_awards (
      id ${pk},
      org_id text not null,
      bid_id text not null,
      bid_line_id text not null,
      invite_id text not null,
      purchase_order_id text,
      amount_cents integer not null
    )`);
  }
  holder.sqlite.exec("create index if not exists bid_requests_org on bid_requests (org_id, project_id)");
  holder.sqlite.exec("create index if not exists bid_lines_bid on bid_lines (org_id, bid_id)");
  holder.sqlite.exec("create index if not exists bid_files_bid on bid_files (org_id, bid_id)");
  holder.sqlite.exec("create unique index if not exists bid_invites_vendor on bid_invites (org_id, bid_id, contact_id)");
  holder.sqlite.exec("create index if not exists bid_invites_contact on bid_invites (org_id, contact_id)");
  holder.sqlite.exec("create unique index if not exists bid_prices_line on bid_prices (org_id, invite_id, bid_line_id)");
  holder.sqlite.exec("create unique index if not exists bid_awards_line on bid_awards (org_id, bid_line_id)");
  holder.sqlite.exec("create index if not exists bid_awards_bid on bid_awards (org_id, bid_id)");
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

function ensureDraws(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "organizations", "payment_terms_days", "integer not null default 7");
  ensureColumn(holder, "organizations", "default_retainage_bps", "integer not null default 0");
  ensureColumn(holder, "organizations", "default_draws_json", "text");
  ensureColumn(holder, "projects", "billing_mode", "text not null default 'draws'");
  ensureColumn(holder, "projects", "retainage_bps", "integer not null default 0");
  ensureColumn(holder, "invoices", "application_number", "integer");
  ensureColumn(holder, "invoices", "retainage_cents", "integer not null default 0");
  if (!tableExists(holder.sqlite, "draws", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists draws (
      id ${pk},
      org_id text not null,
      project_id text not null,
      title text not null,
      basis text not null,
      bps integer not null default 0,
      amount_cents integer not null,
      schedule_item_id text,
      due_on text,
      sort_order integer not null default 0,
      invoice_id text,
      change_order_id text,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "pay_app_lines", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists pay_app_lines (
      id ${pk},
      org_id text not null,
      invoice_id text not null,
      source_key text not null,
      name text not null,
      scheduled_cents integer not null,
      previous_cents integer not null,
      this_cents integer not null,
      percent_bps integer not null,
      retainage_cents integer not null,
      sort_order integer not null default 0
    )`);
  }
  holder.sqlite.exec("create index if not exists draws_project on draws (org_id, project_id)");
  holder.sqlite.exec("create index if not exists pay_app_lines_invoice on pay_app_lines (org_id, invoice_id)");
}

function ensureRfis(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "rfis", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists rfis (
      id ${pk},
      org_id text not null,
      project_id text not null,
      number integer not null,
      title text not null,
      question text not null,
      due_on text,
      status text not null,
      assignee_kind text not null,
      assignee_user_id text,
      assignee_contact_id text,
      related_type text,
      related_id text,
      internal_note text,
      cost_impact integer not null default 0,
      cost_impact_cents integer,
      schedule_impact_days integer,
      change_order_id text,
      schedule_shifted_at text,
      answered_at text,
      closed_at text,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  if (!tableExists(holder.sqlite, "rfi_messages", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists rfi_messages (
      id ${pk},
      org_id text not null,
      rfi_id text not null,
      body text not null,
      author_kind text not null,
      author_user_id text,
      author_name text not null,
      internal integer not null default 0,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "rfi_files", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists rfi_files (
      id ${pk},
      org_id text not null,
      rfi_id text not null,
      message_id text,
      document_id text not null,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "rfi_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists rfi_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists rfis_number on rfis (org_id, project_id, number)");
  holder.sqlite.exec("create index if not exists rfis_org on rfis (org_id, project_id)");
  holder.sqlite.exec("create index if not exists rfi_messages_rfi on rfi_messages (org_id, rfi_id)");
  holder.sqlite.exec("create index if not exists rfi_files_rfi on rfi_files (org_id, rfi_id)");
  holder.sqlite.exec("create index if not exists rfi_attempts_org on rfi_attempts (org_id, created_at)");
}

function ensureSubmittals(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "submittals", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists submittals (
      id ${pk},
      org_id text not null,
      project_id text not null,
      number integer not null,
      title text not null,
      spec_note text not null,
      division text,
      status text not null,
      due_on text,
      assignee_kind text not null,
      assignee_user_id text,
      assignee_contact_id text,
      related_type text,
      related_id text,
      internal_note text,
      revision integer not null,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  if (!tableExists(holder.sqlite, "submittal_revisions", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists submittal_revisions (
      id ${pk},
      org_id text not null,
      submittal_id text not null,
      revision integer not null,
      note text not null default '',
      review_note text,
      author_name text not null,
      reviewer_name text,
      created_at text not null,
      reviewed_at text
    )`);
  }
  if (!tableExists(holder.sqlite, "submittal_files", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists submittal_files (
      id ${pk},
      org_id text not null,
      submittal_id text not null,
      revision_id text not null,
      document_id text not null,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "submittal_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists submittal_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists submittals_number on submittals (org_id, project_id, number)");
  holder.sqlite.exec("create index if not exists submittals_org on submittals (org_id, project_id)");
  holder.sqlite.exec("create unique index if not exists submittal_revisions_rev on submittal_revisions (org_id, submittal_id, revision)");
  holder.sqlite.exec("create index if not exists submittal_files_sub on submittal_files (org_id, submittal_id)");
  holder.sqlite.exec("create index if not exists submittal_attempts_org on submittal_attempts (org_id, created_at)");
}

function ensureLienWaivers(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "organizations", "lien_waiver_mode", "text not null default 'warn'");
  if (!tableExists(holder.sqlite, "lien_waiver_templates", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists lien_waiver_templates (
      id ${pk},
      org_id text not null,
      type text not null,
      body text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "lien_waivers", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists lien_waivers (
      id ${pk},
      org_id text not null,
      bill_id text not null,
      project_id text not null,
      vendor_contact_id text not null,
      type text not null,
      status text not null,
      amount_cents integer not null,
      through_date text not null,
      body text not null,
      signed_name text,
      signed_at text,
      signed_text text,
      document_id text,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  if (!tableExists(holder.sqlite, "lien_waiver_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists lien_waiver_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists lien_waiver_templates_org_type on lien_waiver_templates (org_id, type)");
  holder.sqlite.exec("create index if not exists lien_waivers_org_bill on lien_waivers (org_id, bill_id)");
  holder.sqlite.exec("create index if not exists lien_waivers_vendor on lien_waivers (org_id, vendor_contact_id)");
  holder.sqlite.exec("create index if not exists lien_waiver_attempts_org on lien_waiver_attempts (org_id, created_at)");
}

function ensureJobFiles(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "file_folder_defaults", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists file_folder_defaults (
      id ${pk},
      org_id text not null,
      name text not null,
      kind text not null,
      visibility text not null,
      sort_order integer not null default 0,
      archived_at text
    )`);
  }
  if (!tableExists(holder.sqlite, "file_folders", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists file_folders (
      id ${pk},
      org_id text not null,
      project_id text not null,
      name text not null,
      kind text not null,
      visibility text not null,
      vendor_contact_id text,
      sort_order integer not null default 0,
      archived_at text,
      created_at text not null,
      updated_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "job_files", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists job_files (
      id ${pk},
      org_id text not null,
      project_id text not null,
      folder_id text not null,
      document_id text not null,
      name text not null,
      revision_group_id text not null,
      revision integer not null,
      is_current integer not null default 1,
      visibility_override text,
      share_history integer not null default 0,
      byte_size integer not null default 0,
      uploaded_by_name text not null,
      uploaded_by_user_id text,
      uploaded_by_contact_id text,
      deleted_at text,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "plan_refs", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists plan_refs (
      id ${pk},
      org_id text not null,
      target_type text not null,
      target_id text not null,
      revision_group_id text not null,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "job_file_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists job_file_attempts (
      id ${pk},
      org_id text not null,
      ip text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists file_folder_defaults_org on file_folder_defaults (org_id, sort_order)");
  holder.sqlite.exec("create index if not exists file_folders_project on file_folders (org_id, project_id)");
  holder.sqlite.exec("create index if not exists job_files_project on job_files (org_id, project_id)");
  holder.sqlite.exec("create index if not exists job_files_group on job_files (org_id, revision_group_id)");
  holder.sqlite.exec("create unique index if not exists plan_refs_target on plan_refs (org_id, target_type, target_id, revision_group_id)");
  holder.sqlite.exec("create index if not exists job_file_attempts_org on job_file_attempts (org_id, created_at)");
}

function ensureComments(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "comments", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists comments (
      id ${pk},
      org_id text not null,
      entity_type text not null,
      entity_id text not null,
      project_id text,
      author_id text not null,
      body text not null,
      created_at text not null,
      edited_at text,
      deleted_at text
    )`);
  }
  if (!tableExists(holder.sqlite, "comment_mentions", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists comment_mentions (
      id ${pk},
      org_id text not null,
      comment_id text not null,
      kind text not null,
      user_id text,
      role text
    )`);
  }
  if (!tableExists(holder.sqlite, "comment_files", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists comment_files (
      id ${pk},
      org_id text not null,
      comment_id text not null,
      document_id text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "notifications", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists notifications (
      id ${pk},
      org_id text not null,
      user_id text not null,
      kind text not null,
      comment_id text,
      entity_type text not null,
      entity_id text not null,
      project_id text,
      actor_id text,
      actor_name text not null,
      snippet text not null,
      read_at text,
      created_at text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "notification_settings", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists notification_settings (
      user_id ${pk},
      org_id text not null,
      mode text not null
    )`);
  }
  if (!tableExists(holder.sqlite, "comment_attempts", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists comment_attempts (
      id ${pk},
      org_id text not null,
      user_id text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists comments_entity on comments (org_id, entity_type, entity_id)");
  holder.sqlite.exec("create index if not exists comment_mentions_comment on comment_mentions (org_id, comment_id)");
  holder.sqlite.exec("create index if not exists comment_files_comment on comment_files (org_id, comment_id)");
  holder.sqlite.exec("create index if not exists notifications_user on notifications (org_id, user_id, created_at)");
  holder.sqlite.exec("create index if not exists comment_attempts_user on comment_attempts (org_id, user_id, created_at)");
}

function ensureSchedulePlan(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "workday_exceptions", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists workday_exceptions (
      id ${pk},
      org_id text not null,
      project_id text,
      title text not null,
      kind text not null,
      start_date text not null,
      end_date text not null,
      yearly integer not null default 0,
      created_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists workday_exceptions_org on workday_exceptions (org_id, start_date)");
  if (!tableExists(holder.sqlite, "schedule_baselines", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists schedule_baselines (
      id ${pk},
      org_id text not null,
      project_id text not null,
      finish_date text not null,
      current integer not null default 0,
      set_at text not null,
      set_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists schedule_baselines_project on schedule_baselines (org_id, project_id, current)");
  if (!tableExists(holder.sqlite, "schedule_baseline_items", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists schedule_baseline_items (
      id ${pk},
      org_id text not null,
      baseline_id text not null,
      item_id text not null,
      start_date text not null,
      end_date text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists schedule_baseline_items_base on schedule_baseline_items (org_id, baseline_id)");
  if (!tableExists(holder.sqlite, "schedule_delays", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists schedule_delays (
      id ${pk},
      org_id text not null,
      project_id text not null,
      item_id text not null,
      days integer not null,
      reason text not null,
      note text,
      actor_id text,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists schedule_delays_project on schedule_delays (org_id, project_id)");
}

function ensurePermits(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "organizations", "inspection_gate", "text not null default 'warn'");
  if (!tableExists(holder.sqlite, "permits", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists permits (
      id ${pk},
      org_id text not null,
      project_id text not null,
      permit_type text not null,
      number text not null default '',
      jurisdiction text not null default '',
      status text not null,
      applied_on text,
      issued_on text,
      expires_on text,
      fee_cents integer,
      cost_code text,
      cost_item_id text,
      show_passed integer not null default 0,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists permits_project on permits (org_id, project_id)");
  if (!tableExists(holder.sqlite, "inspections", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists inspections (
      id ${pk},
      org_id text not null,
      project_id text not null,
      permit_id text not null,
      root_id text not null,
      attempt integer not null,
      name text not null,
      schedule_item_id text,
      requested_on text,
      scheduled_on text,
      inspector text,
      result text not null,
      result_on text,
      notes text not null default '',
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists inspections_permit on inspections (org_id, permit_id)");
  holder.sqlite.exec("create index if not exists inspections_project on inspections (org_id, project_id)");
  if (!tableExists(holder.sqlite, "inspection_gates", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists inspection_gates (
      id ${pk},
      org_id text not null,
      inspection_id text not null,
      schedule_item_id text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists inspection_gates_item on inspection_gates (org_id, inspection_id, schedule_item_id)");
  if (!tableExists(holder.sqlite, "record_files", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists record_files (
      id ${pk},
      org_id text not null,
      target_type text not null,
      target_id text not null,
      job_file_id text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists record_files_target on record_files (org_id, target_type, target_id, job_file_id)");
  if (!tableExists(holder.sqlite, "template_permits", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_permits (
      id ${pk},
      org_id text not null,
      template_id text not null,
      item_key text not null,
      permit_type text not null,
      jurisdiction text not null default ''
    )`);
  }
  holder.sqlite.exec("create index if not exists template_permits_template on template_permits (org_id, template_id)");
  if (!tableExists(holder.sqlite, "template_inspections", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_inspections (
      id ${pk},
      org_id text not null,
      template_id text not null,
      item_key text not null,
      permit_key text not null,
      name text not null,
      offset_workdays integer not null,
      schedule_key text
    )`);
  }
  holder.sqlite.exec("create index if not exists template_inspections_template on template_inspections (org_id, template_id)");
  if (!tableExists(holder.sqlite, "template_inspection_gates", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists template_inspection_gates (
      id ${pk},
      org_id text not null,
      template_id text not null,
      inspection_key text not null,
      task_key text not null
    )`);
  }
  holder.sqlite.exec("create index if not exists template_inspection_gates_template on template_inspection_gates (org_id, template_id)");
}

function ensureMarkup(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "markups", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists markups (
      id ${pk},
      org_id text not null,
      project_id text not null,
      target_type text not null,
      target_id text not null,
      source_document_id text not null,
      page integer not null default 1,
      layer_json text not null,
      flat_document_id text not null,
      created_at text not null,
      updated_at text not null,
      created_by text,
      updated_by text
    )`);
  }
  holder.sqlite.exec("create unique index if not exists markups_target on markups (org_id, target_type, target_id, page)");
  if (!tableExists(holder.sqlite, "plan_pins", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists plan_pins (
      id ${pk},
      org_id text not null,
      project_id text not null,
      job_file_id text not null,
      number integer not null,
      x_milli integer not null,
      y_milli integer not null,
      link_type text not null,
      link_id text not null,
      note text not null default '',
      crop_document_id text,
      copied_from_id text,
      reviewed integer not null default 1,
      created_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists plan_pins_file on plan_pins (org_id, job_file_id)");
}

function ensureEquipment(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  if (!tableExists(holder.sqlite, "equipment", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists equipment (
      id ${pk},
      org_id text not null,
      name text not null,
      category text not null,
      make_model text not null default '',
      serial text not null default '',
      tag text not null default '',
      purchased_on text,
      cost_cents integer,
      rate_cents integer,
      rate_unit text,
      status text not null,
      location_kind text not null,
      project_id text,
      user_id text,
      notes text not null default '',
      document_id text,
      service_interval integer,
      service_unit text,
      last_service_on text,
      hours_since_service integer not null default 0,
      last_seen_project_id text,
      last_seen_at text,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists equipment_org on equipment (org_id)");
  if (!tableExists(holder.sqlite, "equipment_assignments", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists equipment_assignments (
      id ${pk},
      org_id text not null,
      equipment_id text not null,
      project_id text,
      user_id text,
      expected_return text,
      checked_out_at text not null,
      checked_in_at text,
      from_label text not null,
      to_label text not null,
      hours integer,
      cost_cents integer,
      cost_item_id text,
      cost_state text not null default '',
      created_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists equipment_assignments_item on equipment_assignments (org_id, equipment_id)");
  if (!tableExists(holder.sqlite, "daily_log_equipment", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists daily_log_equipment (
      id ${pk},
      org_id text not null,
      log_id text not null,
      equipment_id text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists daily_log_equipment_once on daily_log_equipment (org_id, log_id, equipment_id)");
}

function ensureAutomations(holder: Holder) {
  const pk = holder.dialect === "postgres" ? "text primary key" : "text primary key not null";
  ensureColumn(holder, "schedule_items", "held", "integer not null default 0");
  if (!tableExists(holder.sqlite, "automation_rules", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists automation_rules (
      id ${pk},
      org_id text not null,
      name text not null,
      enabled integer not null default 1,
      trigger_kind text not null,
      trigger_json text not null,
      conditions_json text not null,
      actions_json text not null,
      last_run_at text,
      run_count integer not null default 0,
      created_at text not null,
      updated_at text not null,
      created_by text
    )`);
  }
  holder.sqlite.exec("create index if not exists automation_rules_org on automation_rules (org_id, enabled)");
  if (!tableExists(holder.sqlite, "automation_runs", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists automation_runs (
      id ${pk},
      org_id text not null,
      rule_id text not null,
      key text not null,
      record_type text not null,
      record_id text not null,
      record_label text not null,
      actions_json text not null,
      result text not null,
      error text,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists automation_runs_key on automation_runs (org_id, key)");
  holder.sqlite.exec("create index if not exists automation_runs_rule on automation_runs (org_id, rule_id)");
  if (!tableExists(holder.sqlite, "automation_notices", holder.dialect)) {
    holder.sqlite.exec(`create table if not exists automation_notices (
      id ${pk},
      org_id text not null,
      rule_id text not null,
      user_id text not null default '',
      role text not null default '',
      title text not null,
      href text not null,
      record_key text not null,
      created_at text not null
    )`);
  }
  holder.sqlite.exec("create unique index if not exists automation_notices_once on automation_notices (org_id, rule_id, record_key, user_id, role)");
  holder.sqlite.exec("create index if not exists automation_notices_org on automation_notices (org_id)");
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
