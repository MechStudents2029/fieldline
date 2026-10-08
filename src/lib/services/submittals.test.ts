import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, documents, submittalFiles } from "@/lib/db/schema";
import { IP_LIMIT } from "@/lib/lead-form/rules";
import { id, nowIso } from "@/lib/ids";
import { authenticate } from "@/lib/services/read";
import {
  clientPortalSubmittals,
  clientReviewSubmittal,
  createSubmittal,
  jobSubmittals,
  reviewSubmittal,
  submittalDetail,
  submittalQueue,
  submitSubmittal,
  vendorCreateSubmittal,
  vendorPortalSubmittals,
} from "@/lib/services/submittals";
import { vendorFileAllowed } from "@/lib/services/vendor-portal";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = Buffer.from("%PDF-1.4");

const draft = {
  title: "Hinge spec",
  spec: "Brushed hinge, two per door.",
  division: "08 00",
  dueOn: "2026-12-01",
  assignee: "user:user_dana",
  related: null,
  internalNote: "Keep the allowance off the portal.",
};

describe("submittals", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps submittal rows on the member policy and out of the money policy", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in array array["), sql.lastIndexOf("foreach tbl in array array["));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in array array["));
    for (const table of ["submittals", "submittal_revisions", "submittal_files", "submittal_attempts"]) {
      expect(member).toContain(`'${table}'`);
      expect(money).not.toContain(`'${table}'`);
    }
  });

  it("scopes the seed by company, vendor, client, and field", () => {
    const maya = actor("maya@rivera.demo");
    const board = jobSubmittals(maya, "proj_okonkwo");
    expect(board?.items.map((item) => item.label)).toEqual(["SUB-001", "SUB-002"]);
    expect(board?.items.find((item) => item.title === "Shower valve cut sheet")).toMatchObject({ overdue: true, revision: 2, division: "22 00" });
    expect(submittalQueue(maya)).toMatchObject({ overdue: { count: 1 }, awaiting: { count: 1 } });
    expect(jobSubmittals(actor("jordan@northline.demo"), "proj_okonkwo")).toBeNull();
    const field = submittalDetail(actor("dana@rivera.demo"), "sub_ok_valve");
    expect(field?.internalNote).toBeNull();
    expect(JSON.stringify(field)).not.toContain("Allowance stays");
    const vendor = vendorPortalSubmittals(DEMO_HARBOR_PORTAL_TOKEN);
    expect(vendor.items.map((item) => item.title)).toEqual(["Shower valve cut sheet"]);
    expect(JSON.stringify(vendor)).not.toContain("Tile sample");
    expect(JSON.stringify(vendor)).not.toContain("Allowance stays");
    expect(vendor.items[0]?.revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(vendor.items[0]?.revisions[0]?.reviewNote).toBe("Move the valve 2 inches.");
    expect(clientPortalSubmittals("demo_portal_okonkwo")).toEqual([]);
    expect(clientPortalSubmittals("demo_portal_brooks")).toEqual([]);
  });

  it("does not reuse a voided number", () => {
    const maya = actor("maya@rivera.demo");
    expect(() => createSubmittal(actor("riley@rivera.demo"), "proj_chen", draft)).toThrow(/cannot change/i);
    expect(() => reviewSubmittal(actor("dana@rivera.demo"), "sub_ok_tile", "approved", "")).toThrow(/cannot change/i);
    const first = createSubmittal(maya, "proj_chen", draft);
    const second = createSubmittal(maya, "proj_chen", { ...draft, title: "Second spec" });
    reviewSubmittal(maya, first, "void", "");
    const third = createSubmittal(maya, "proj_chen", { ...draft, title: "Third spec" });
    const items = jobSubmittals(maya, "proj_chen")?.items ?? [];
    expect(items.map((item) => item.label)).toEqual(["SUB-001", "SUB-002", "SUB-003"]);
    expect(items.find((item) => item.id === first)?.status).toBe("void");
    expect(items.find((item) => item.id === third)?.number).toBe(3);
    expect(second).toBeTruthy();
    const audits = getDb().select().from(auditLogs).where(and(eq(auditLogs.orgId, "org_rivera"), eq(auditLogs.entityId, first))).all();
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["submittal.create", "submittal.void"]));
  });

  it("keeps the prior revision when a new one is submitted", () => {
    const maya = actor("maya@rivera.demo");
    const submittalId = createSubmittal(maya, "proj_chen", { ...draft, title: "Valve package", assignee: "user:user_dana" }, [
      { filename: "first.pdf", bytes: pdf },
    ]);
    submitSubmittal(maya, submittalId, "First package", [{ filename: "sheet.pdf", bytes: pdf }]);
    expect(() => reviewSubmittal(maya, submittalId, "noted", "")).toThrow(/note/i);
    reviewSubmittal(maya, submittalId, "revise", "Move the valve 2 inches.");
    submitSubmittal(maya, submittalId, "Moved", [{ filename: "moved.pdf", bytes: pdf }]);
    const detail = submittalDetail(maya, submittalId);
    expect(detail?.revision).toBe(2);
    expect(detail?.status).toBe("submitted");
    expect(detail?.revisions).toHaveLength(2);
    expect(detail?.revisions[0]?.reviewNote).toBe("Move the valve 2 inches.");
    expect(detail?.revisions[0]?.files.length).toBeGreaterThan(0);
    expect(detail?.revisions[1]?.note).toBe("Moved");
    expect(detail?.revisions[1]?.files.map((file) => file.filename)).toEqual(["moved.pdf"]);
    const audits = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, submittalId)).all().map((row) => row.action);
    expect(audits).toEqual(expect.arrayContaining(["submittal.create", "submittal.submit", "submittal.review"]));
  });

  it("lets the client review only the submittal assigned to them", () => {
    const maya = actor("maya@rivera.demo");
    const submittalId = createSubmittal(maya, "proj_okonkwo", { ...draft, title: "Client hinge", assignee: "client", internalNote: "Office only." }, [
      { filename: "hinge.pdf", bytes: pdf },
    ]);
    submitSubmittal(maya, submittalId, "For review", [{ filename: "hinge.pdf", bytes: pdf }]);
    expect(clientPortalSubmittals("demo_portal_okonkwo").map((item) => item.title)).toEqual(["Client hinge"]);
    expect(JSON.stringify(clientPortalSubmittals("demo_portal_okonkwo"))).not.toContain("Office only");
    expect(JSON.stringify(clientPortalSubmittals("demo_portal_okonkwo"))).not.toContain("Shower valve");
    expect(vendorPortalSubmittals(DEMO_HARBOR_PORTAL_TOKEN).items.map((item) => item.title)).not.toContain("Client hinge");
    expect(() => clientReviewSubmittal({ token: "demo_portal_okonkwo", submittalId: "sub_ok_valve", status: "approved", note: "", ip: "198.51.100.20" })).toThrow(/not found/i);
    clientReviewSubmittal({ token: "demo_portal_okonkwo", submittalId, status: "approved", note: "Looks right.", ip: "198.51.100.21" });
    expect(submittalDetail(maya, submittalId)?.status).toBe("approved");
    expect(submittalQueue(maya).awaiting.count).toBe(1);
  });

  it("opens an office file on a vendor submittal for that vendor only", () => {
    const db = getDb();
    const documentId = id("doc");
    db.insert(documents)
      .values({
        id: documentId,
        orgId: "org_rivera",
        projectId: "proj_okonkwo",
        leadId: null,
        contactId: null,
        type: "submittal",
        filename: "office-note.pdf",
        storagePath: "uploads/org_rivera/office-note.pdf",
        metadataJson: null,
        deletedAt: null,
        createdAt: nowIso(),
        createdBy: "user_maya",
      })
      .run();
    db.insert(submittalFiles)
      .values({ id: id("subf"), orgId: "org_rivera", submittalId: "sub_ok_valve", revisionId: "subv_ok_valve_2", documentId, createdAt: nowIso() })
      .run();
    expect(vendorFileAllowed(DEMO_HARBOR_PORTAL_TOKEN, documentId)).toBe(true);
    expect(vendorFileAllowed("not-a-portal", documentId)).toBe(false);
  });

  it("counts a new overdue submittal and rate limits portal writes", () => {
    const maya = actor("maya@rivera.demo");
    createSubmittal(maya, "proj_okonkwo", { ...draft, title: "Late trim", assignee: "user:user_maya", dueOn: "2020-01-01" });
    submitSubmittal(maya, jobSubmittals(maya, "proj_okonkwo")?.items.find((item) => item.title === "Late trim")?.id ?? "", "Sent", [{ filename: "trim.png", bytes: png }]);
    expect(submittalQueue(maya).overdue.count).toBe(2);
    expect(submittalQueue(maya).awaiting.count).toBe(2);
    for (let index = 0; index < IP_LIMIT; index += 1) {
      vendorCreateSubmittal({
        token: DEMO_HARBOR_PORTAL_TOKEN,
        projectId: "proj_okonkwo",
        title: `Portal spec ${index}`,
        spec: "Cut sheet",
        division: "22 00",
        dueOn: "2026-12-01",
        note: "From the shop",
        files: [{ filename: "sheet.png", bytes: png }],
        ip: "203.0.113.77",
      });
    }
    expect(() =>
      vendorCreateSubmittal({
        token: DEMO_HARBOR_PORTAL_TOKEN,
        projectId: "proj_okonkwo",
        title: "One more",
        spec: "Cut sheet",
        division: "22 00",
        dueOn: "2026-12-01",
        note: "",
        files: [{ filename: "sheet.png", bytes: png }],
        ip: "203.0.113.77",
      }),
    ).toThrow(/Too many requests/);
  });
});
