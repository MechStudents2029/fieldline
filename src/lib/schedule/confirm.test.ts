import { describe, expect, it } from "vitest";
import { confirmPill, nextConfirmStatus, resetsOnMove } from "@/lib/schedule/confirm";

describe("confirmation state", () => {
  it("requests from any state and only answers a request", () => {
    expect(nextConfirmStatus(null, "request")).toBe("requested");
    expect(nextConfirmStatus("confirmed", "request")).toBe("requested");
    expect(nextConfirmStatus("declined", "request")).toBe("requested");
    expect(nextConfirmStatus("requested", "confirm")).toBe("confirmed");
    expect(nextConfirmStatus("requested", "decline")).toBe("declined");
    expect(() => nextConfirmStatus("confirmed", "confirm")).toThrow(/confirm/);
    expect(() => nextConfirmStatus(null, "decline")).toThrow(/decline/);
    expect(() => nextConfirmStatus("declined", "confirm")).toThrow(/confirm/);
  });

  it("resets only a confirmed item", () => {
    expect(resetsOnMove("confirmed")).toBe(true);
    expect(resetsOnMove("requested")).toBe(false);
    expect(resetsOnMove("declined")).toBe(false);
    expect(resetsOnMove(null)).toBe(false);
    expect(confirmPill("declined")).toBe("Declined");
    expect(confirmPill(null)).toBeNull();
  });
});
