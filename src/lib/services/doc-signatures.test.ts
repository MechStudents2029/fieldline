import fs from "node:fs";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dataDir, getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, documents } from "@/lib/db/schema";
import { createBill } from "@/lib/services/bills";
import { mentionUnread } from "@/lib/services/comments";
import {
  createSignatureRequest,
  declineByToken,
  markSignatureSent,
  officeCertificate,
  replaceTradeAgreement,
  setTradeWarn,
  signByToken,
  signatureAttention,
  signatureCertificateByToken,
  signatureCsv,
  signatureRequest,
  signatureRequests,
  tradePills,
  tradeWarning,
  vendorTrades,
  voidSignatureRequest,
} from "@/lib/services/doc-signatures";
import { createPurchaseOrder } from "@/lib/services/purchase-orders";
import { authenticate } from "@/lib/services/read";
import { fileSha256 } from "@/lib/signatures/request";
import { resolveInside } from "@/lib/security";
import { localDay } from "@/lib/time/calendar";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const drawn = `data:image/png;base64,${png.toString("base64")}`;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

function sign(token: string, name: string, startedAt = Date.now() - 4_000) {
  return signByToken({
    token,
    typedName: name,
    drawn,
    startedAt: String(startedAt),
    companyUrl: "",
    ip: "203.0.113.9",
    userAgent: "Test",
  });
}

describe("document signatures", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds a signed subcontract, a past-due change order, and a pending trade agreement", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const rows = signatureRequests(maya);
    expect(rows.find((row) => row.id === "dsr_brighton")?.status).toBe("signed");
    expect(rows.find((row) => row.id === "dsr_co")?.overdue).toBe(true);
    expect(rows.find((row) => row.id === "dsr_harbor")?.kind).toBe("trade");
    expect(signatureAttention(maya)).toEqual({ count: 1, href: "/signatures?overdue=1" });
    expect(signatureAttention(dana)).toEqual({ count: 0, href: null });
    expect(signatureRequests(dana)).toEqual([]);
    expect(signatureRequest(dana, "dsr_co")).toBeNull();
    expect(tradePills(maya.orgId).c_harbor).toBe("Pending");
    expect(tradePills(maya.orgId).c_brighton).toBeUndefined();
    const certificate = officeCertificate(maya, "dsr_brighton");
    expect(certificate?.title).toBe("Subcontract");
    expect(certificate?.signers[0]?.name).toBe("Noah Kim");
    expect(certificate?.hash).toBe(fileSha256(pdfOf("doc_sign_brighton.pdf")));
    expect(signatureCsv(maya)).toContain("Subcontract");
    expect(signatureCsv(maya, { overdue: true })).toContain("Change order");
    expect(signatureCsv(dana)).not.toContain("Change order");
    expect(mentionUnread(maya)).toBe(2);
    expect(tradeWarning(maya.orgId, "c_harbor")).toBeNull();
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in"), sql.lastIndexOf("foreach tbl in"));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in"));
    for (const table of ["doc_sign_requests", "doc_signers", "doc_sign_attempts"]) {
      expect(member).toContain(`'${table}'`);
      expect(money).toContain(`'${table}'`);
    }
    expect(() => createSignatureRequest(dana, { title: "Nope", signers: [{ role: "vendor", contactId: "c_harbor" }], file: { filename: "a.pdf", bytes: pdf } })).toThrow(/cannot request/);
    expect(() => voidSignatureRequest(actor("luis@rivera.demo"), "dsr_co", "Stop")).toThrow(/owner or admin/);
  });

  it("follows signing order, keeps the file hash, and warns only when the setting is on", () => {
    const maya = actor("maya@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const created = createSignatureRequest(luis, {
      title: "Vendor packet",
      ordered: true,
      signers: [
        { role: "vendor", contactId: "c_brighton" },
        { role: "client", contactId: "c_brooks" },
      ],
      file: { filename: "packet.pdf", bytes: pdf },
    });
    markSignatureSent(luis, created.id);
    const detail = signatureRequest(maya, created.id);
    expect(detail?.status).toBe("out");
    const [first, second] = detail?.signers ?? [];
    expect(first && second).toBeTruthy();
    const source = getDb().select().from(documents).where(eq(documents.id, detail!.documentId!)).get();
    const before = pdfOfPath(source!.storagePath);
    expect(fileSha256(before)).toBe(detail?.docHash);
    expect(() => sign(second!.token, "Chris Brooks")).toThrow(/earlier/);
    expect(sign(first!.token, "Noah Kim")).toEqual({ id: created.id });
    expect(signatureRequest(maya, created.id)?.status).toBe("out");
    expect(signatureCertificateByToken(second!.token)).toBeNull();
    expect(sign(second!.token, "Chris Brooks")).toEqual({ id: created.id });
    expect(signatureRequest(maya, created.id)?.status).toBe("signed");
    const after = pdfOfPath(source!.storagePath);
    expect(after.equals(before)).toBe(true);
    const certificate = signatureCertificateByToken(first!.token);
    expect(certificate?.hash).toBe(fileSha256(before));
    expect(certificate?.signers.map((row) => row.name)).toEqual(["Noah Kim", "Chris Brooks"]);
    expect(certificate?.audit.map((row) => row.action)).toEqual(["signature.create", "signature.link", "signature.sign", "signature.sign"]);

    const declined = createSignatureRequest(maya, {
      title: "NDA",
      signers: [{ role: "vendor", contactId: "c_harbor" }],
      file: { filename: "nda.pdf", bytes: pdf },
    });
    markSignatureSent(maya, declined.id);
    const nda = signatureRequest(maya, declined.id);
    expect(() => signByToken({ token: nda!.signers[0].token, typedName: "Pete", drawn, startedAt: String(Date.now()), companyUrl: "", ip: "203.0.113.4", userAgent: "Test" })).toThrow(/Wait/);
    expect(signByToken({ token: nda!.signers[0].token, typedName: "Pete", drawn, startedAt: String(Date.now() - 4_000), companyUrl: "http://spam", ip: "203.0.113.4", userAgent: "Test" })).toEqual({ dropped: "honeypot" });
    expect(declineByToken({ token: nda!.signers[0].token, reason: "Not our scope", startedAt: String(Date.now() - 4_000), companyUrl: "", ip: "203.0.113.4", userAgent: "Test" })).toEqual({ id: declined.id });
    expect(signatureRequest(maya, declined.id)?.status).toBe("declined");
    expect(signatureRequest(maya, declined.id)?.declineReason).toBe("Not our scope");

    expect(() => voidSignatureRequest(luis, created.id, "Wrong file")).toThrow(/owner or admin/);
    voidSignatureRequest(maya, created.id, "Wrong file");
    expect(signatureRequest(maya, created.id)?.status).toBe("voided");
    expect(() => voidSignatureRequest(maya, created.id, "Again")).toThrow(/already/);

    const replaced = replaceTradeAgreement(maya, "dsr_harbor", { filename: "trade-v2.pdf", bytes: pdf });
    const history = vendorTrades(maya, "c_harbor");
    expect(history.rows.map((row) => row.version).sort()).toEqual([1, 2]);
    expect(history.rows.find((row) => row.id === "dsr_harbor")?.status).toBe("out");
    expect(history.rows.find((row) => row.id === replaced.id)?.status).toBe("draft");
    expect(tradePills(maya.orgId).c_harbor).toBe("Pending");

    const quiet = createPurchaseOrder(maya, { projectId: "proj_brooks_bath", vendorContactId: "c_harbor", lines: [{ costCode: "DEMO-GUT", amountCents: 2_000 }] });
    expect(quiet.warning).toBeNull();
    setTradeWarn(maya, true);
    const warned = createPurchaseOrder(maya, { projectId: "proj_brooks_bath", vendorContactId: "c_harbor", lines: [{ costCode: "DEMO-GUT", amountCents: 3_000 }] });
    expect(warned.id).toBeTruthy();
    expect(warned.warning).toMatch(/trade agreement/);
    const today = localDay(Date.now(), "America/New_York");
    const bill = createBill(maya, {
      projectId: "proj_brooks_bath",
      vendorContactId: "c_harbor",
      billNumber: "TRADE-WARN-1",
      billDate: today,
      dueDate: "2026-12-01",
      lines: [{ costCode: "DEMO-GUT", amountCents: 1_000 }],
    });
    expect(bill.id).toBeTruthy();
    expect(bill.warning).toMatch(/trade agreement/);
    setTradeWarn(maya, false);
    expect(tradeWarning(maya.orgId, "c_harbor")).toBeNull();

    const audits = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, created.id)).all().map((row) => row.action);
    expect(audits).toContain("signature.void");
    expect(signatureRequest(actor("jordan@northline.demo"), created.id)).toBeNull();
  });
});

function pdfOf(name: string): Buffer {
  const file = resolveInside(dataDir(), `uploads/org_rivera/${name}`);
  if (!file) throw new Error(name);
  return fs.readFileSync(file);
}

function pdfOfPath(storagePath: string): Buffer {
  const file = resolveInside(dataDir(), storagePath);
  if (!file) throw new Error(storagePath);
  return fs.readFileSync(file);
}
