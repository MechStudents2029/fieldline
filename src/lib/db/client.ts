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
  ensureTesterFeedback(holder);
  ensureTeamInvites(holder);
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
