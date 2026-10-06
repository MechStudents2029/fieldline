import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { useDatabaseFile } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { contacts, lineItems, priceBookItems, projects } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import { commitImport, previewImport, undoImport } from "@/lib/services/import";
import { firstProposal } from "@/lib/services/onboarding";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const nora = "Display Name,Email,Phone\nNora Import,nora.import.unit@example.com,5105550198\n";

describe("import service", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("keeps field, office, and other companies out of the batch", () => {
    const maya = actor("maya@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    expect(() => previewImport(actor("dana@rivera.demo"), { kind: "contacts", csv: nora, mapping: null })).toThrow(/owner or admin/);
    expect(() => commitImport(actor("luis@rivera.demo"), { kind: "contacts", csv: nora, mapping: [], choices: [] })).toThrow(/owner or admin/);
    expect(() => undoImport(actor("riley@rivera.demo"), "imp_missing")).toThrow(/owner or admin/);
    expect(previewImport(actor("sam@rivera.demo"), { kind: "contacts", csv: nora, mapping: null }).counts.new).toBe(1);
    const qbo = "Display Name,Email\nAmara Okonkwo,amara.okonkwo@example.com\n";
    expect(previewImport(maya, { kind: "contacts", csv: qbo, mapping: null }).rows[0].detail).toBe("Same email");
    expect(previewImport(jordan, { kind: "contacts", csv: qbo, mapping: null }).rows[0].status).toBe("new");
    const before = getDb().select({ id: contacts.id }).from(contacts).where(eq(contacts.orgId, "org_rivera")).all().length;
    const imported = commitImport(jordan, {
      kind: "contacts",
      csv: "Display Name,Email\nNorth Client,north.import.unit@example.com\n",
      mapping: ["name", "email"],
      choices: [{ index: 0, choice: "import" }],
    });
    expect(getDb().select({ id: contacts.id }).from(contacts).where(eq(contacts.orgId, "org_rivera")).all().length).toBe(before);
    const created = getDb().select().from(contacts).where(eq(contacts.email, "north.import.unit@example.com")).all();
    expect(created.map((row) => row.orgId)).toEqual(["org_northline"]);
    undoImport(jordan, imported.batchId);
    expect(getDb().select().from(contacts).where(eq(contacts.email, "north.import.unit@example.com")).all()).toEqual([]);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    expect(sql).toContain("'import_batches'");
    expect(sql).toContain("'import_rows'");
    expect(firstProposal("org_rivera")).toBeNull();
  });

  it("creates a contact and removes it on undo", () => {
    const maya = actor("maya@rivera.demo");
    const imported = commitImport(maya, { kind: "contacts", csv: nora, mapping: ["name", "email", "phone"], choices: [{ index: 0, choice: "import" }] });
    expect(getDb().select().from(contacts).where(eq(contacts.email, "nora.import.unit@example.com")).get()?.name).toBe("Nora Import");
    expect(undoImport(maya, imported.batchId)).toEqual({ blocked: 0, reason: null });
    expect(getDb().select().from(contacts).where(eq(contacts.email, "nora.import.unit@example.com")).get()).toBeUndefined();
    expect(undoImport(maya, imported.batchId)).toEqual({ blocked: 0, reason: null });
  });

  it("reverts a field on a contact who already has a job", () => {
    const maya = actor("maya@rivera.demo");
    const before = getDb().select().from(contacts).where(eq(contacts.id, "c_okonkwo")).get();
    const imported = commitImport(maya, {
      kind: "contacts",
      csv: "Display Name,Email,Phone\nAmara Okonkwo,amara.okonkwo@example.com,5105550100\n",
      mapping: ["name", "email", "phone"],
      choices: [{ index: 0, choice: "update" }],
    });
    expect(getDb().select().from(contacts).where(eq(contacts.id, "c_okonkwo")).get()?.phone).toBe("5105550100");
    expect(undoImport(maya, imported.batchId).blocked).toBe(0);
    expect(getDb().select().from(contacts).where(eq(contacts.id, "c_okonkwo")).get()?.phone).toBe(before?.phone);
  });

  it("refuses undo after a later edit or after the new contact is put on a job", () => {
    const maya = actor("maya@rivera.demo");
    const edited = commitImport(maya, {
      kind: "contacts",
      csv: "Display Name,Email,Phone\nTom Briggs,tom.briggs@example.com,5105550101\n",
      mapping: ["name", "email", "phone"],
      choices: [{ index: 0, choice: "update" }],
    });
    getDb().update(contacts).set({ updatedAt: "2099-01-01T00:00:00.000Z" }).where(eq(contacts.id, "c_briggs")).run();
    expect(undoImport(maya, edited.batchId).reason).toBe("Changed since import");
    expect(getDb().select().from(contacts).where(eq(contacts.id, "c_briggs")).get()?.phone).toBe("5105550101");

    const imported = commitImport(maya, {
      kind: "contacts",
      csv: "Display Name,Email\nJob Client,job.import.unit@example.com\n",
      mapping: ["name", "email"],
      choices: [{ index: 0, choice: "import" }],
    });
    const created = getDb().select().from(contacts).where(eq(contacts.email, "job.import.unit@example.com")).get();
    getDb().update(projects).set({ contactId: created!.id }).where(eq(projects.id, "proj_chen")).run();
    expect(undoImport(maya, imported.batchId).reason).toBe("Used on a job");
    expect(getDb().select().from(contacts).where(eq(contacts.id, created!.id)).get()).toBeTruthy();
    getDb().update(projects).set({ contactId: "c_chen" }).where(eq(projects.id, "proj_chen")).run();
  });

  it("refuses undo when a created price item is on an estimate", () => {
    const maya = actor("maya@rivera.demo");
    const csv = "Name,Unit,Unit Cost,Cost Code\nImport only item,ea,25.00,IMPORT-ONLY\n";
    const mapping = ["name", "unit", "cost", "code"];
    const clean = commitImport(maya, { kind: "price_book", csv, mapping, choices: [{ index: 0, choice: "import" }] });
    expect(undoImport(maya, clean.batchId).blocked).toBe(0);
    expect(getDb().select().from(priceBookItems).where(eq(priceBookItems.code, "IMPORT-ONLY")).get()).toBeUndefined();

    const used = commitImport(maya, {
      kind: "price_book",
      csv: "Name,Unit,Unit Cost,Cost Code\nImport used item,ea,30.00,IMPORT-USED\n",
      mapping,
      choices: [{ index: 0, choice: "import" }],
    });
    const item = getDb().select().from(priceBookItems).where(eq(priceBookItems.code, "IMPORT-USED")).get();
    const line = getDb().select().from(lineItems).where(eq(lineItems.orgId, "org_rivera")).get();
    const previous = line?.priceBookItemId ?? null;
    getDb().update(lineItems).set({ priceBookItemId: item!.id }).where(eq(lineItems.id, line!.id)).run();
    expect(undoImport(maya, used.batchId).reason).toBe("Used on a job");
    expect(getDb().select().from(priceBookItems).where(eq(priceBookItems.id, item!.id)).get()).toBeTruthy();
    getDb().update(lineItems).set({ priceBookItemId: previous }).where(eq(lineItems.id, line!.id)).run();
  });
});
