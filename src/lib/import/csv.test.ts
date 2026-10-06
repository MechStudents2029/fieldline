import { describe, expect, it } from "vitest";
import { ImportParseError, parseCsv } from "@/lib/import/csv";

describe("csv parser", () => {
  it("keeps quoted commas, quotes, and embedded newlines", () => {
    const table = parseCsv('Name,Notes\n"Okonkwo, Amara","He said ""hi""\nstill one row"\n');
    expect(table.headers).toEqual(["Name", "Notes"]);
    expect(table.rows).toEqual([["Okonkwo, Amara", 'He said "hi"\nstill one row']]);
    expect(table.delimiter).toBe(",");
  });

  it("strips a BOM and accepts CRLF", () => {
    const table = parseCsv("\uFEFFName,Email\r\nAda,ada@example.com\r\n");
    expect(table.headers).toEqual(["Name", "Email"]);
    expect(table.rows).toEqual([["Ada", "ada@example.com"]]);
  });

  it("uses semicolons when the header has more of them", () => {
    const table = parseCsv('Name;Email;City\n"Ada; North";ada@example.com;Oakland\n');
    expect(table.delimiter).toBe(";");
    expect(table.rows[0]).toEqual(["Ada; North", "ada@example.com", "Oakland"]);
  });

  it("rejects an empty file, a header with no rows, too many rows, and a large file", () => {
    expect(() => parseCsv("")).toThrow(ImportParseError);
    expect(() => parseCsv("   \n")).toThrow(/empty/);
    expect(() => parseCsv("Name,Email\n")).toThrow(/no rows/);
    const rows = ["Name,Email", ...Array.from({ length: 5001 }, (_, index) => `Person ${index},p${index}@example.com`)];
    expect(() => parseCsv(rows.join("\n"))).toThrow(/5,000 rows/);
    expect(() => parseCsv("x".repeat(1_000_001))).toThrow(/1 MB/);
  });
});
