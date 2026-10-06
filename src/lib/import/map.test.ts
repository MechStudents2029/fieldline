import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/import/csv";
import { autoMap, csvTemplate } from "@/lib/import/map";

const qbo = `Display Name,Company,First Name,Last Name,Email,Phone,Billing Street,Billing City,Billing State,Billing ZIP
Amara Okonkwo,Okonkwo,Amara,Okonkwo,amara.okonkwo@example.com,(510) 555-0166,901 Mandana Blvd,Oakland,CA,94610`;

describe("header auto-map", () => {
  it("maps a QuickBooks Online customer export", () => {
    const table = parseCsv(qbo);
    expect(autoMap(table.headers, "contacts")).toEqual(["name", "company", "first", "last", "email", "phone", "street", "city", "state", "zip"]);
  });

  it("maps a Buildertrend-style contacts export and does not let name steal company", () => {
    const table = parseCsv("Contact Name,Company Name,Email,Cell,Address,City,State,Zip\nAda,Ada Co,ada@example.com,5105550100,1 Main,Oakland,CA,94610");
    expect(autoMap(table.headers, "contacts")).toEqual(["name", "company", "email", "phone", "street", "city", "state", "zip"]);
  });

  it("maps price book headers", () => {
    const table = parseCsv(csvTemplate("price_book") + "Tile,sf,12.00,18.00,33%,TILE,Tile");
    expect(autoMap(table.headers, "price_book")).toEqual(["name", "unit", "cost", "price", "margin", "code", "category"]);
  });
});
