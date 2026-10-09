import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, bills, jobFiles } from "@/lib/db/schema";
import { vendorBidPortal } from "@/lib/services/bids";
import {
  clientMayReadDocument,
  clientPortalFiles,
  deleteJobFile,
  fieldMayReadDocument,
  folderDefaults,
  jobFileBoard,
  reviseJobFile,
  saveFolderDefault,
  setFileVisibility,
  setShareHistory,
  uploadJobFile,
  uploadVendorJobFile,
  vendorPortalFiles,
} from "@/lib/services/files";
import { authenticate } from "@/lib/services/read";
import { vendorFileAllowed, vendorPortal } from "@/lib/services/vendor-portal";
import { rotateVendorPortal } from "@/lib/services/vendor-portal";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

describe("job files", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds Okonkwo plans, a client folder, and a sub folder", () => {
    const maya = actor("maya@rivera.demo");
    const board = jobFileBoard(maya, "proj_okonkwo");
    expect(board?.folders.map((folder) => folder.name)).toEqual(["Plans", "Specs", "Contracts", "Photos", "Harbor Plumbing"]);
    expect(board?.folders.find((folder) => folder.name === "Plans")?.visibility).toBe("subs");
    expect(board?.folders.find((folder) => folder.name === "Photos")?.visibility).toBe("client");
    expect(board?.folders.find((folder) => folder.name === "Contracts")?.visibility).toBe("team");
    const plans = board?.files.filter((file) => file.name === "A-101 floor plan") ?? [];
    expect(plans.map((file) => [file.revision, file.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(plans.find((file) => file.current)?.uploadedBy).toBe("Maya Rivera");
    expect(board?.files.some((file) => file.name === "Valve photo")).toBe(true);
    expect(folderDefaults(maya)?.map((folder) => folder.name)).toEqual(["Plans", "Specs", "Contracts", "Photos"]);
  });

  it("hides vendor folders and money files from field, and client folders from the other portals", () => {
    const dana = actor("dana@rivera.demo");
    const field = jobFileBoard(dana, "proj_okonkwo");
    expect(field?.folders.map((folder) => folder.name)).toEqual(["Plans", "Specs", "Contracts", "Photos"]);
    expect(field?.canAddPhoto).toBe(true);
    expect(field?.canEdit).toBe(false);
    expect(field?.files.some((file) => file.name === "Valve photo")).toBe(false);
    expect(field?.files.some((file) => file.superseded)).toBe(true);
    getDb().update(bills).set({ documentId: "doc_receipt_casa" }).where(eq(bills.id, "bill_ok_harbor")).run();
    const after = jobFileBoard(dana, "proj_okonkwo");
    expect(after?.attached.some((row) => row.href.includes("bill"))).toBe(false);
    expect(after?.attached.some((row) => row.record === "Daily log")).toBe(true);
    expect(jobFileBoard(actor("maya@rivera.demo"), "proj_okonkwo")?.attached.some((row) => row.href.includes("/bills/"))).toBe(true);
    expect(fieldMayReadDocument(getDb(), "org_rivera", "doc_ok_a101_r2")).toBe(true);
    expect(fieldMayReadDocument(getDb(), "org_rivera", "doc_ok_harbor")).toBe(false);
    expect(fieldMayReadDocument(getDb(), "org_rivera", "doc_receipt_casa")).toBe(false);
    const client = clientPortalFiles("demo_portal_okonkwo");
    expect(client?.folders.map((folder) => folder.name)).toEqual(["Photos"]);
    expect(JSON.stringify(client)).not.toContain("A-101");
    expect(JSON.stringify(client)).not.toContain("Contracts");
    expect(clientMayReadDocument(getDb(), "doc_ok_a101_r2")).toBe(false);
    expect(clientMayReadDocument(getDb(), "doc_o1")).toBe(true);
    expect(JSON.stringify(clientPortalFiles("demo_portal_north_home"))).not.toContain("A-101");
    expect(jobFileBoard(actor("jordan@northline.demo"), "proj_okonkwo")).toBeNull();
    expect(() => uploadJobFile(actor("jordan@northline.demo"), { projectId: "proj_okonkwo", folderId: "ff_ok_plans", file: { filename: "x.pdf", bytes: pdf } })).toThrow(/not found/);
    expect(() => uploadJobFile(actor("riley@rivera.demo"), { projectId: "proj_okonkwo", folderId: "ff_ok_photos", file: { filename: "x.png", bytes: png } })).toThrow(/cannot/);
  });

  it("shows the current plan to subs on the job and keeps the vendor folder private", () => {
    const harbor = vendorPortalFiles(DEMO_HARBOR_PORTAL_TOKEN);
    const ok = harbor?.find((job) => job.projectId === "proj_okonkwo");
    expect(ok?.folders.map((folder) => folder.name).sort()).toEqual(["Harbor Plumbing", "Plans"]);
    const plans = ok?.folders.find((folder) => folder.name === "Plans")?.files ?? [];
    expect(plans.map((file) => file.name)).toEqual(["A-101 floor plan"]);
    expect(plans[0]?.revision).toBe(2);
    expect(JSON.stringify(harbor)).not.toContain("Contracts");
    expect(vendorFileAllowed(DEMO_HARBOR_PORTAL_TOKEN, "doc_ok_a101_r2")).toBe(true);
    expect(vendorFileAllowed(DEMO_HARBOR_PORTAL_TOKEN, "doc_ok_a101_r1")).toBe(false);
    expect(vendorBidPortal(DEMO_HARBOR_PORTAL_TOKEN)?.[0]?.plans.map((plan) => plan.filename)).toContain("A-101 floor plan");
    expect(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN)?.orders.find((order) => order.number === "PO-1044")?.plans.map((plan) => plan.name)).toEqual(["A-101 floor plan"]);
    const casa = rotateVendorPortal(actor("maya@rivera.demo"), "c_casa");
    const casaFiles = vendorPortalFiles(casa);
    expect(JSON.stringify(casaFiles)).toContain("A-101 floor plan");
    expect(JSON.stringify(casaFiles)).not.toContain("Valve photo");
    expect(JSON.stringify(casaFiles)).not.toContain("Contracts");
    expect(vendorFileAllowed(casa, "doc_ok_harbor")).toBe(false);
    expect(vendorPortalFiles("not-a-portal")).toBeNull();
  });

  it("audits upload, revision, visibility, and delete", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const plans = jobFileBoard(maya, "proj_okonkwo")?.folders.find((folder) => folder.name === "Plans");
    const photos = jobFileBoard(maya, "proj_okonkwo")?.folders.find((folder) => folder.name === "Photos");
    expect(plans && photos).toBeTruthy();
    expect(() => uploadJobFile(dana, { projectId: "proj_okonkwo", folderId: plans!.id, file: { filename: "site.png", bytes: png } })).toThrow(/cannot/);
    const photo = uploadJobFile(dana, { projectId: "proj_okonkwo", folderId: photos!.id, file: { filename: "curb.png", bytes: png } });
    const added = uploadJobFile(maya, { projectId: "proj_okonkwo", folderId: plans!.id, file: { filename: "A-102.pdf", bytes: pdf } });
    const revised = reviseJobFile(maya, { projectId: "proj_okonkwo", fileId: added.id, file: { filename: "A-102-rev.pdf", bytes: pdf } });
    expect(revised.revision).toBe(2);
    setFileVisibility(maya, { projectId: "proj_okonkwo", fileId: revised.id, visibility: "client" });
    deleteJobFile(maya, { projectId: "proj_okonkwo", fileId: photo.id });
    const actions = getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityType, "file"))
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["file.upload", "file.revision", "file.visibility", "file.delete"]));
    expect(getDb().select().from(jobFiles).where(eq(jobFiles.id, photo.id)).get()?.deletedAt).toBeTruthy();
    const client = clientPortalFiles("demo_portal_okonkwo");
    expect(client?.folders.find((folder) => folder.name === "Photos")?.files.some((file) => file.name === "curb")).toBe(false);
    setShareHistory(maya, { projectId: "proj_okonkwo", fileId: "jf_ok_a101_r2", share: true });
    expect(vendorPortalFiles(DEMO_HARBOR_PORTAL_TOKEN)?.find((job) => job.projectId === "proj_okonkwo")?.folders.find((folder) => folder.name === "Plans")?.files.map((file) => file.revision).sort()).toEqual([1, 2]);
    setShareHistory(maya, { projectId: "proj_okonkwo", fileId: "jf_ok_a101_r2", share: false });
    const uploaded = uploadVendorJobFile({ token: DEMO_HARBOR_PORTAL_TOKEN, projectId: "proj_okonkwo", file: { filename: "trim.png", bytes: png }, ip: "127.0.0.1" });
    expect(uploaded.id).toBeTruthy();
    expect(jobFileBoard(maya, "proj_okonkwo")?.files.some((file) => file.name === "trim")).toBe(true);
    expect(jobFileBoard(dana, "proj_okonkwo")?.files.some((file) => file.name === "trim")).toBe(false);
    const casa = rotateVendorPortal(maya, "c_casa");
    expect(JSON.stringify(vendorPortalFiles(casa))).not.toContain("trim");
  });

  it("copies company folders onto a job that has none", () => {
    const maya = actor("maya@rivera.demo");
    saveFolderDefault(maya, { name: "Warranties", kind: "general", visibility: "team" });
    expect(jobFileBoard(maya, "proj_chen")?.folders.map((folder) => folder.name)).toContain("Warranties");
    expect(jobFileBoard(maya, "proj_okonkwo")?.folders.map((folder) => folder.name)).not.toContain("Warranties");
    const warranties = folderDefaults(maya)?.find((folder) => folder.name === "Warranties");
    saveFolderDefault(maya, { id: warranties?.id, name: "Warranties", kind: "general", visibility: "team", archive: true });
    expect(jobFileBoard(maya, "proj_brooks")?.folders.map((folder) => folder.name)).not.toContain("Warranties");
    expect(folderDefaults(actor("jordan@northline.demo"))?.map((folder) => folder.name)).toEqual(["Plans", "Specs", "Contracts", "Photos"]);
  });
});
