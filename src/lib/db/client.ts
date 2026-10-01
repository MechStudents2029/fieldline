import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { SEED_VERSION, seedDatabase } from "@/lib/db/seed";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

type Holder = {
  db: AppDatabase;
  sqlite: Database.Database;
};

const globalForDb = globalThis as unknown as { fieldline?: Holder };

function migrationSql(): string {
  const file = path.join(process.cwd(), "drizzle", "0000_init.sql");
  return fs.readFileSync(file, "utf8").replace(/--> statement-breakpoint/g, "");
}

function open(file: string): Holder {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  if (file !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

export function ensureReady(holder: Holder) {
  if (!tableExists(holder.sqlite, "organizations")) {
    holder.sqlite.exec(migrationSql());
  }
  const version = holder.sqlite
    .prepare("select value from app_meta where key = 'seed_version'")
    .get() as { value: string } | undefined;
  if (!version || version.value !== SEED_VERSION) {
    seedDatabase(holder.db, holder.sqlite);
  }
}

export function databasePath(): string {
  return process.env.FIELDLINE_DB || path.join(process.cwd(), "data", "fieldline.db");
}

export function getHolder(): Holder {
  if (!globalForDb.fieldline) {
    globalForDb.fieldline = open(databasePath());
    ensureReady(globalForDb.fieldline);
  }
  return globalForDb.fieldline;
}

export function getDb(): AppDatabase {
  return getHolder().db;
}

export function getSqlite(): Database.Database {
  return getHolder().sqlite;
}

/** Test helper. Reopens the singleton on a new file or :memory:. */
export function useDatabaseFile(file: string): AppDatabase {
  if (globalForDb.fieldline) {
    globalForDb.fieldline.sqlite.close();
    globalForDb.fieldline = undefined;
  }
  globalForDb.fieldline = open(file);
  ensureReady(globalForDb.fieldline);
  return globalForDb.fieldline.db;
}

export function resetDatabase(): AppDatabase {
  const file = databasePath();
  if (globalForDb.fieldline) {
    globalForDb.fieldline.sqlite.close();
    globalForDb.fieldline = undefined;
  }
  if (file !== ":memory:" && fs.existsSync(file)) fs.rmSync(file);
  return getDb();
}
