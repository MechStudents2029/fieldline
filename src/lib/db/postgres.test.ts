import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { useDatabaseFile, usePostgresMemory } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { splitSql, toPostgresDdl, translateSqliteQuery } from "@/lib/db/sql";
import { getDb } from "@/lib/db/client";
import { authenticate, leadDetail } from "@/lib/services/read";
import { createLeadFromText } from "@/lib/services/write";

describe("postgres sql", () => {
  it("quotes identifiers and rewrites sqlite placeholders", () => {
    expect(toPostgresDdl("CREATE TABLE `organizations` (`id` text);--> statement-breakpoint")).toContain(
      '"organizations"',
    );
    expect(translateSqliteQuery("select * from \"leads\" where \"name\" like ? and \"id\" = ?")).toBe(
      'select * from "leads" where "name" ilike $1 and "id" = $2',
    );
    expect(translateSqliteQuery("select '?' as q where 'it''s' = ?")).toBe("select '?' as q where 'it''s' = $1");
    expect(splitSql("begin; select 1;")).toEqual(["begin", "select 1"]);
    const ddl = toPostgresDdl(fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_init.sql"), "utf8"));
    expect(ddl.indexOf('alter table "memberships"')).toBeGreaterThan(ddl.indexOf('CREATE TABLE "organizations"'));
    expect(ddl.match(/CREATE TABLE "memberships"[\s\S]*?\);/)?.[0]).not.toMatch(/FOREIGN KEY/);
  });
});

describe("postgres memory", () => {
  beforeAll(() => {
    usePostgresMemory();
  }, 60_000);

  afterAll(() => {
    useDatabaseFile(":memory:");
  });

  it("migrates, seeds, and inserts on Postgres", () => {
    const org = getDb().select().from(organizations).where(eq(organizations.id, "org_rivera")).get();
    expect(org?.name).toBe("Rivera Remodeling & Trade");
    const maya = authenticate("maya@rivera.demo", "demo");
    expect(maya?.orgId).toBe("org_rivera");
    const created = createLeadFromText(maya!, "Nora Hale, 120 sq ft bath, new tile. 18 Birch St, Oakland.");
    expect(leadDetail("org_rivera", created.leadId)?.lead.id).toBe(created.leadId);
    expect(leadDetail("org_northline", created.leadId)).toBeNull();
  });
});
