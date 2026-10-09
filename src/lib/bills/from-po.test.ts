import { describe, expect, it } from "vitest";
import { billFromPo, lineFigures, overRemainingMessage } from "@/lib/bills/from-po";

const shower = [{ id: "pol", costCode: "PLB-SHOWER", description: "Shower package", amountCents: 500_000 }];

describe("bill from a purchase order", () => {
  it("keeps billed and remaining to the cent", () => {
    const [line] = lineFigures(shower, [
      { costCode: "plb-shower", amountCents: 200_000 },
      { costCode: "PLB-SHOWER", amountCents: 100_000 },
    ]);
    expect(line).toMatchObject({ billedCents: 300_000, remainingCents: 200_000 });
    const full = lineFigures(shower, [{ costCode: "PLB-SHOWER", amountCents: 650_000 }]);
    expect(full[0]).toMatchObject({ billedCents: 500_000, remainingCents: 0 });
  });

  it("applies the purchase order percent to the remaining amount", () => {
    const lines = lineFigures(shower, [{ costCode: "PLB-SHOWER", amountCents: 300_000 }]);
    expect(billFromPo(lines, 1000)).toEqual({
      lines: [{ costCode: "PLB-SHOWER", description: "Shower package", amountCents: 200_000 }],
      amountCents: 200_000,
      retainageCents: 20_000,
      netCents: 180_000,
    });
    expect(billFromPo(lines, 0).retainageCents).toBe(0);
    expect(billFromPo(lineFigures(shower, [{ costCode: "PLB-SHOWER", amountCents: 500_000 }]), 1000).lines).toEqual([]);
  });

  it("names the cost code when a line is past what is left", () => {
    const lines = lineFigures(shower, [{ costCode: "PLB-SHOWER", amountCents: 300_000 }]);
    expect(
      overRemainingMessage(
        "PO-1055",
        lines,
        lines.map((line) => ({ costCode: line.costCode, amountCents: line.billedCents })),
        [{ costCode: "PLB-SHOWER", amountCents: 250_000 }],
      ),
    ).toBe("This bill is past PO-1055: $500.00 over on PLB-SHOWER.");
    expect(
      overRemainingMessage(
        "PO-1055",
        lines,
        lines.map((line) => ({ costCode: line.costCode, amountCents: line.billedCents })),
        [{ costCode: "PLB-SHOWER", amountCents: 200_000 }],
      ),
    ).toBeNull();
  });
});
