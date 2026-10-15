import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, documents } from "@/lib/db/schema";
import {
  certAssignWarning,
  createCredential,
  credentialAttention,
  credentialCounts,
  credentialCsv,
  credentialDetail,
  fieldOwnsCredentialFile,
  listCredentials,
  markCredentialRequested,
  revokeCredential,
  saveCredentialTypes,
} from "@/lib/services/certifications";
import { mentionUnread } from "@/lib/services/comments";
import { authenticate } from "@/lib/services/read";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("crew certifications", () => {
  beforeAll(() => {
    useDatabaseFile(":memory:");
  });

  it("seeds an expired card, a 30-day card, a current card, and one requested row", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const sam = actor("sam@rivera.demo");
    expect(listCredentials(maya).map((row) => row.id).sort()).toEqual(["cred_dana_osha", "cred_luis_fork", "cred_maya_osha"]);
    expect(credentialDetail(maya, "cred_dana_osha").status).toBe("expired");
    expect(credentialDetail(maya, "cred_dana_osha").requestedByName).toBe("Maya Rivera");
    expect(credentialDetail(maya, "cred_maya_osha").bucket).toBe("30");
    expect(credentialDetail(maya, "cred_luis_fork").bucket).toBe("current");
    expect(credentialAttention(maya)).toEqual({ count: 2, href: "/certifications?window=due" });
    expect(credentialAttention(dana).count).toBe(1);
    expect(credentialCounts(maya)).toMatchObject({ expired: 1, d30: 1 });
    expect(listCredentials(dana).map((row) => row.id)).toEqual(["cred_dana_osha"]);
    expect(() => credentialDetail(dana, "cred_maya_osha")).toThrow(/not found/);
    expect(JSON.stringify(listCredentials(dana))).not.toContain("OSHA-30-2201");
    expect(JSON.stringify(listCredentials(riley))).not.toContain("OSHA-30-2201");
    expect(credentialDetail(riley, "cred_maya_osha").numberLabel).toBe("2201");
    expect(credentialCsv(maya)).toContain("OSHA-30-2201");
    expect(credentialCsv(sam)).toContain("OSHA-10-4419");
    expect(credentialCsv(luis)).not.toContain("OSHA-30-2201");
    expect(credentialCsv(dana)).not.toContain("OSHA-10-4419");
    expect(credentialCsv(riley)).not.toContain("FL-1884");
    expect(certAssignWarning(maya, ["user_dana"])).toBe("Dana Cho · OSHA 10");
    expect(certAssignWarning(maya, ["user_luis"])).toBeNull();
    expect(mentionUnread(maya)).toBe(2);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    expect(sql).toContain("'credential_types'");
    expect(sql).toContain("'crew_credentials'");
  });

  it("lets the member upload a card and keeps type edits in the office", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    expect(() =>
      createCredential(riley, { typeId: "ctype_cpr", issuedOn: "2026-01-02", expiresOn: "2027-01-02", number: "CPR-1" }),
    ).toThrow(/cannot change/);
    expect(() => saveCredentialTypes(dana, [{ id: "ctype_cpr", name: "CPR/First Aid", required: false, archived: true }])).toThrow(/office/);
    expect(() => revokeCredential(dana, "cred_maya_osha")).toThrow(/office/);
    const own = createCredential(dana, {
      userId: "user_maya",
      typeId: "ctype_cpr",
      number: "CPR-100",
      issuedOn: "2026-01-02",
      expiresOn: "2027-06-01",
      upload: { filename: "card.png", bytes: PNG },
    });
    const card = credentialDetail(dana, own.id);
    expect(card.userId).toBe(dana.userId);
    expect(card.numberLabel).toBe("CPR-100");
    expect(card.documentId).toBeTruthy();
    expect(fieldOwnsCredentialFile(dana.orgId, dana.userId, card.documentId!)).toBe(true);
    expect(fieldOwnsCredentialFile(dana.orgId, maya.userId, card.documentId!)).toBe(false);
    expect(getDb().select().from(documents).where(eq(documents.id, card.documentId!)).get()?.type).toBe("credential");
    expect(() =>
      createCredential(maya, { typeId: "ctype_cpr", userId: dana.userId, issuedOn: "2026-01-02", expiresOn: "2027-01-02", upload: { filename: "card.svg", bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") } }),
    ).toThrow(/JPEG|photo or a PDF/);
    const open = createCredential(maya, { typeId: "ctype_driver", userId: "user_luis", issuedOn: "2020-01-01", doesNotExpire: true, number: "D-1" });
    expect(credentialDetail(maya, open.id).status).toBe("active");
    expect(credentialDetail(maya, open.id).bucket).toBe("none");
    markCredentialRequested(maya, "cred_maya_osha");
    expect(credentialDetail(maya, "cred_maya_osha").requestedByName).toBe("Maya Rivera");
    expect(() => markCredentialRequested(maya, "cred_maya_osha")).toThrow(/Already requested/);
    revokeCredential(maya, own.id);
    expect(credentialDetail(maya, own.id).status).toBe("revoked");
    const actions = getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, own.id))
      .all()
      .map((row) => row.action)
      .sort();
    expect(actions).toEqual(["credential.create", "credential.revoke"]);
    expect(
      getDb()
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, "cred_maya_osha"))
        .all()
        .some((row) => row.action === "credential.request"),
    ).toBe(true);
  });
});
