import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  certificateLines,
  fileSha256,
  isOverdue,
  sendError,
  statusAfter,
  tradePill,
  turnError,
  voidError,
  type SignerState,
} from "@/lib/signatures/request";

const signers: SignerState[] = [
  { id: "a", sortOrder: 0, status: "waiting" },
  { id: "b", sortOrder: 1, status: "waiting" },
];

describe("document signature rules", () => {
  it("sends a draft that has a file and a signer", () => {
    expect(sendError("draft", true, 1)).toBeNull();
    expect(sendError("out", true, 1)).toMatch(/draft/);
    expect(sendError("draft", false, 1)).toMatch(/document/);
    expect(sendError("draft", true, 0)).toMatch(/signer/);
  });

  it("keeps a signing order and finishes when every signer has signed", () => {
    expect(turnError(true, signers, "b")).toMatch(/earlier/);
    expect(turnError(true, signers, "a")).toBeNull();
    expect(turnError(false, signers, "b")).toBeNull();
    const afterFirst = statusAfter(
      [
        { id: "a", sortOrder: 0, status: "signed" },
        { id: "b", sortOrder: 1, status: "waiting" },
      ],
      "sign",
    );
    expect(afterFirst).toBe("out");
    expect(turnError(true, [{ id: "a", sortOrder: 0, status: "signed" }, { id: "b", sortOrder: 1, status: "waiting" }], "b")).toBeNull();
    expect(
      statusAfter(
        [
          { id: "a", sortOrder: 0, status: "signed" },
          { id: "b", sortOrder: 1, status: "signed" },
        ],
        "sign",
      ),
    ).toBe("signed");
    expect(statusAfter(signers, "decline")).toBe("declined");
  });

  it("voids with a reason and hashes the file bytes", () => {
    expect(voidError("out", "Wrong file", true)).toBeNull();
    expect(voidError("voided", "Again", true)).toMatch(/already/);
    expect(voidError("signed", "  ", true)).toMatch(/reason/);
    expect(voidError("draft", "Stop", false)).toMatch(/owner or admin/);
    const bytes = Buffer.from("%PDF-1.4 signature");
    expect(fileSha256(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fileSha256(bytes)).not.toBe(createHash("sha256").update(bytes.toString("utf8") + "x").digest("hex"));
  });

  it("marks overdue requests and trade pills", () => {
    expect(isOverdue("out", "2026-10-15", "2026-10-16")).toBe(true);
    expect(isOverdue("out", "2026-10-16", "2026-10-16")).toBe(false);
    expect(isOverdue("signed", "2026-10-01", "2026-10-16")).toBe(false);
    expect(isOverdue("draft", null, "2026-10-16")).toBe(false);
    expect(tradePill([])).toBeNull();
    expect(tradePill([{ status: "out", version: 1 }])).toBe("Pending");
    expect(tradePill([{ status: "signed", version: 1 }, { status: "out", version: 2 }])).toBe("Pending");
    expect(tradePill([{ status: "voided", version: 2 }, { status: "signed", version: 1 }])).toBe("Approved");
  });

  it("puts the file hash and each signer on the certificate", () => {
    const hash = fileSha256(Buffer.from("change order"));
    const lines = certificateLines({
      title: "Change order",
      hash,
      signers: [{ name: "Chris Brooks", role: "client", at: "2026-10-16T14:00:00.000Z", ip: "203.0.113.8", userAgent: "Test" }],
      audit: [{ action: "signature.sign", at: "2026-10-16T14:00:00.000Z" }],
    });
    expect(lines[0]).toBe("Change order");
    expect(lines[1]).toBe(hash);
    expect(lines.join("\n")).toContain("Chris Brooks");
    expect(lines.join("\n")).toContain("203.0.113.8");
    expect(lines.join("\n")).toContain("signature.sign");
  });
});