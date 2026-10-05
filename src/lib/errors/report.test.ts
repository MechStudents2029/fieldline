import { describe, expect, it } from "vitest";
import { boundaryLogLine, clientErrorReference } from "@/lib/errors/report";

describe("crash reference", () => {
  it("reuses a server digest and otherwise makes a short id", () => {
    expect(clientErrorReference("digest_12ab")).toBe("digest_12ab");
    expect(clientErrorReference("bad digest")).toMatch(/^[0-9a-f]{8}$/);
    expect(clientErrorReference()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("writes one structured line without a screenshot or a stack", () => {
    const line = boundaryLogLine({
      ref: "digest_12ab",
      path: "/projects/proj_okonkwo",
      message: "E2E crash check",
      digest: "digest_12ab",
    });
    const parsed = JSON.parse(line) as { level: string; source: string; ref: string; path: string };
    expect(parsed).toMatchObject({
      level: "error",
      source: "fieldline",
      ref: "digest_12ab",
      path: "/projects/proj_okonkwo",
    });
    expect(line).not.toContain("data:image");
    expect(line).not.toContain("stack");
  });
});
