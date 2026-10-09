import { describe, expect, it } from "vitest";
import { defaultSubmittalList } from "@/lib/submittals/format";
import {
  assessPayGate,
  displayWaiverState,
  renderWaiver,
  requiredWaiverType,
  waiverIsFinal,
  waiverMissingForToday,
  DEFAULT_WAIVER_BODIES,
} from "@/lib/waivers/format";

describe("waiver wording", () => {
  it("fills the template and leaves the sentence in place", () => {
    const text = renderWaiver(DEFAULT_WAIVER_BODIES.conditional_progress, {
      vendor: "Harbor Plumbing",
      job: "Okonkwo primary bath",
      amount: "$480.00",
      through: "Sep 25",
      bill: "HP-220",
      company: "Rivera Remodeling & Trade",
    });
    expect(text).toContain("Harbor Plumbing");
    expect(text).toContain("Okonkwo primary bath");
    expect(text).toContain("$480.00");
    expect(text).toContain("HP-220");
    expect(text).toContain("only after that amount is paid");
    expect(text).not.toContain("{vendor}");
  });

  it("picks conditional before pay and unconditional after, and final when the job is closed or the bill is last", () => {
    expect(requiredWaiverType("before", false)).toBe("conditional_progress");
    expect(requiredWaiverType("after", false)).toBe("unconditional_progress");
    expect(requiredWaiverType("before", true)).toBe("conditional_final");
    expect(requiredWaiverType("after", true)).toBe("unconditional_final");
    expect(waiverIsFinal(true, 2)).toBe(true);
    expect(waiverIsFinal(false, 0)).toBe(true);
    expect(waiverIsFinal(false, 1)).toBe(false);
  });

  it("warns or blocks only when the required waiver is unsigned", () => {
    expect(assessPayGate("off", false)).toEqual({ error: null, warning: null });
    expect(assessPayGate("warn", true)).toEqual({ error: null, warning: null });
    expect(assessPayGate("block", true)).toEqual({ error: null, warning: null });
    expect(assessPayGate("warn", false).warning).toBe("Lien waiver is not signed.");
    expect(assessPayGate("warn", false).error).toBeNull();
    expect(assessPayGate("block", false).error).toBe("Lien waiver is not signed.");
    expect(assessPayGate("block", false).warning).toBeNull();
  });

  it("shows signed ahead of a request, and counts an unsigned bill that is paid or due within a week", () => {
    expect(displayWaiverState([])).toBe("missing");
    expect(displayWaiverState([{ type: "conditional_progress", status: "requested" }])).toBe("requested");
    expect(displayWaiverState([{ type: "conditional_progress", status: "signed" }, { type: "unconditional_progress", status: "requested" }])).toBe("signed");
    expect(displayWaiverState([{ type: "conditional_progress", status: "void" }])).toBe("missing");
    expect(waiverMissingForToday({ status: "paid", dueDate: null, today: "2026-10-09", requiredSigned: false })).toBe(true);
    expect(waiverMissingForToday({ status: "approved", dueDate: "2026-10-12", today: "2026-10-09", requiredSigned: false })).toBe(true);
    expect(waiverMissingForToday({ status: "approved", dueDate: "2026-10-20", today: "2026-10-09", requiredSigned: false })).toBe(false);
    expect(waiverMissingForToday({ status: "paid", dueDate: null, today: "2026-10-09", requiredSigned: true })).toBe(false);
  });

  it("keeps the default submittal list on open rows until a filter is set", () => {
    const rows = [
      { status: "submitted", title: "SUB-001" },
      { status: "review", title: "SUB-002" },
      { status: "void", title: "SUB-009" },
    ];
    expect(defaultSubmittalList(rows, {}).map((row) => row.title)).toEqual(["SUB-001", "SUB-002"]);
    expect(defaultSubmittalList(rows, { status: "void" }).map((row) => row.title)).toEqual(["SUB-001", "SUB-002", "SUB-009"]);
    expect(defaultSubmittalList(rows, { overdue: true })).toHaveLength(3);
  });
});
