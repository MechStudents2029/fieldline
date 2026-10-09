import { describe, expect, it } from "vitest";
import { PAY_GATE_MESSAGE } from "@/lib/waivers/format";
import { OVER_PO_MESSAGE, billReadiness, certReason, overPoIds } from "@/lib/bills/ready";

describe("ready to pay", () => {
  it("names one reason and blocks only when the company gate says so", () => {
    const warn = billReadiness({
      status: "approved",
      waiverMode: "warn",
      waiverSigned: false,
      certMode: "warn",
      certProblems: [{ type: "workers_comp", state: "missing" }],
      overPo: false,
    });
    expect(warn).toMatchObject({ ready: false, reason: "Waiver unsigned", payError: null, payWarning: PAY_GATE_MESSAGE });

    const blocked = billReadiness({
      status: "approved",
      waiverMode: "block",
      waiverSigned: false,
      certMode: "warn",
      certProblems: [],
      overPo: false,
    });
    expect(blocked.payError).toBe(PAY_GATE_MESSAGE);
    expect(blocked.ready).toBe(false);

    const off = billReadiness({
      status: "approved",
      waiverMode: "off",
      waiverSigned: false,
      certMode: "warn",
      certProblems: [],
      overPo: false,
    });
    expect(off.ready).toBe(true);
    expect(off.payError).toBeNull();

    const certWarn = billReadiness({
      status: "approved",
      waiverMode: "off",
      waiverSigned: true,
      certMode: "warn",
      certProblems: [{ type: "workers_comp", state: "missing" }],
      overPo: false,
    });
    expect(certWarn.ready).toBe(true);
    expect(certWarn.reason).toBeNull();
    expect(certWarn.payWarning).toBe("WC missing");

    const certBlock = billReadiness({
      status: "approved",
      waiverMode: "off",
      waiverSigned: true,
      certMode: "block",
      certProblems: [{ type: "general_liability", state: "expired" }],
      overPo: false,
    });
    expect(certBlock).toMatchObject({ ready: false, reason: "COI expired", payError: "COI expired" });

    const over = billReadiness({
      status: "approved",
      waiverMode: "warn",
      waiverSigned: true,
      certMode: "warn",
      certProblems: [],
      overPo: true,
    });
    expect(over).toMatchObject({ ready: false, reason: "Over PO", payError: OVER_PO_MESSAGE });
    expect(
      billReadiness({
        status: "paid",
        waiverMode: "warn",
        waiverSigned: true,
        certMode: "warn",
        certProblems: [],
        overPo: false,
      }),
    ).toMatchObject({ ready: false, reason: null });
  });

  it("picks the certificate label and flags only the bill that crosses the purchase order", () => {
    expect(certReason([{ type: "workers_comp", state: "missing" }, { type: "general_liability", state: "expired" }])).toBe("COI expired");
    expect(certReason([{ type: "workers_comp", state: "expired" }])).toBe("WC expired");
    expect(certReason([{ type: "general_liability", state: "missing" }])).toBe("COI missing");
    expect(certReason([{ type: "license", state: "missing" }])).toBe("Certificate missing");
    const totals = new Map([["po", 10_000]]);
    const ids = overPoIds(
      [
        { id: "a", purchaseOrderId: "po", status: "approved", kind: "standard", amountCents: 6_000, createdAt: "1" },
        { id: "b", purchaseOrderId: "po", status: "approved", kind: "standard", amountCents: 6_000, createdAt: "2" },
        { id: "c", purchaseOrderId: "po", status: "approved", kind: "release", amountCents: 9_000, createdAt: "3" },
      ],
      totals,
    );
    expect([...ids]).toEqual(["b"]);
  });
});
