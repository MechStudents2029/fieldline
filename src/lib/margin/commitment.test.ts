import { describe, expect, it } from "vitest";
import { openCommitmentByCode, overageByCode } from "@/lib/margin/commitment";

describe("purchase order commitment math", () => {
  it("relieves an issued order by the approved bill and floors at zero", () => {
    expect(openCommitmentByCode([{ costCode: "PLB-TOILET", amountCents: 100_000 }], [{ costCode: "PLB-TOILET", amountCents: 40_000 }])).toEqual([
      { costCode: "PLB-TOILET", amountCents: 60_000 },
    ]);
    expect(openCommitmentByCode([{ costCode: "PLB-TOILET", amountCents: 100_000 }], [{ costCode: "PLB-TOILET", amountCents: 120_000 }])).toEqual([]);
    expect(overageByCode([{ costCode: "PLB-TOILET", amountCents: 100_000 }], [], [{ costCode: "PLB-TOILET", amountCents: 120_000 }])).toEqual([
      { code: "PLB-TOILET", overCents: 20_000 },
    ]);
  });

  it("does not let a bill on one code reduce another", () => {
    expect(
      openCommitmentByCode(
        [
          { costCode: "PLB-TOILET", amountCents: 50_000 },
          { costCode: "GC-SUPER", amountCents: 20_000 },
        ],
        [{ costCode: "PLB-TOILET", amountCents: 50_000 }],
      ),
    ).toEqual([{ costCode: "GC-SUPER", amountCents: 20_000 }]);
  });
});
