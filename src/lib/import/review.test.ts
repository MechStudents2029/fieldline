import { describe, expect, it } from "vitest";
import { proposalChecklist } from "@/lib/onboarding/checklist";
import { parseImportAmount, reviewContacts, reviewPriceBook, rowCounts, withChoices, type ExistingContact, type MappedContact, type MappedItem } from "@/lib/import/review";

const amara: ExistingContact = {
  id: "c_okonkwo",
  type: "client",
  name: "Amara Okonkwo",
  email: "amara.okonkwo@example.com",
  phone: "(510) 555-0166",
};

function contact(over: Partial<MappedContact> = {}): MappedContact {
  return {
    index: 0,
    name: "Nora Import",
    company: "",
    email: "nora@example.com",
    phone: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    notes: "",
    type: "",
    ...over,
  };
}

function item(over: Partial<MappedItem> = {}): MappedItem {
  return { index: 0, name: "Tile", unit: "sf", cost: "", price: "", margin: "", markup: "", code: "", category: "", ...over };
}

describe("import review", () => {
  it("matches email, then phone, then a normalized name, and skips a later copy in the file", () => {
    const rows = reviewContacts(
      [
        contact({ email: "AMARA.OKONKWO@example.com", name: "Someone Else" }),
        contact({ index: 1, email: "", phone: "1 (510) 555-0166", name: "Phone match" }),
        contact({ index: 2, email: "", phone: "", name: "amara  okonkwo!" }),
        contact({ index: 3, email: "nora@example.com" }),
        contact({ index: 4, email: "nora@example.com", name: "Nora again" }),
      ],
      [amara],
      "contacts",
    );
    expect(rows.map((row) => row.detail)).toEqual(["Same email", "Same phone", "Same name", "Client", "Same file"]);
    expect(rows[3].status).toBe("new");
    expect(rows[4].choice).toBe("skip");
    expect(rows[4].matchId).toBe("file:3");
    expect(reviewContacts([contact({ email: "amara.okonkwo@example.com" })], [amara], "vendors")[0].status).toBe("new");
  });

  it("flags a missing name, a bad email, amounts, and units", () => {
    expect(reviewContacts([contact({ name: "  " })], [], "contacts")[0].error).toBe("Need a name");
    expect(reviewContacts([contact({ email: "nope" })], [], "contacts")[0].error).toBe("Bad email");
    expect(parseImportAmount("($12.00)")).toEqual({ error: "Amount is negative" });
    expect(parseImportAmount("10000000")).toEqual({ cents: 1_000_000_000 });
    expect(parseImportAmount("10000000.01")).toEqual({ error: "Over $10M" });
    expect(reviewPriceBook([item({ unit: "box", cost: "10" })], [], 3500)[0].error).toBe("Unknown unit");
    expect(reviewPriceBook([item({ unit: "", cost: "10" })], [], 3500)[0].error).toBe("Unknown unit");
    expect(reviewPriceBook([item({ unit: "Sq. Ft.", cost: "-4" })], [], 3500)[0].error).toBe("Amount is negative");
  });

  it("computes markup from margin, and margin from price", () => {
    const fromMargin = reviewPriceBook([item({ cost: "100", margin: "35%" })], [], 3500)[0];
    expect(fromMargin.item).toMatchObject({ unitCostCents: 10000, defaultMarkupBps: 5385, category: "General", code: "TILE" });
    const fraction = reviewPriceBook([item({ index: 1, cost: "100", margin: "0.35", name: "Fraction" })], [], 3500)[0];
    expect(fraction.item?.defaultMarkupBps).toBe(5385);
    const fromPrice = reviewPriceBook([item({ price: "200", margin: "20%", unit: "ea" })], [], 3500)[0];
    expect(fromPrice.item).toMatchObject({ unitCostCents: 16000, defaultMarkupBps: 2500 });
    const costOnly = reviewPriceBook([item({ cost: "100", unit: "hours" })], [], 3500)[0];
    expect(costOnly.item).toMatchObject({ unit: "hr", defaultMarkupBps: 3500 });
    const both = reviewPriceBook([item({ cost: "100", price: "153.85", margin: "99%" })], [], 3500)[0];
    expect(both.item?.defaultMarkupBps).toBe(5385);
    expect(reviewPriceBook([item({ price: "200" })], [], 3500)[0].error).toBe("Need cost or margin");
    expect(reviewPriceBook([item({ margin: "35%" })], [], 3500)[0].error).toBe("Need cost or margin");
    expect(reviewPriceBook([item({ cost: "100", margin: "100%" })], [], 3500)[0].error).toBe("Margin is too high");
    expect(reviewPriceBook([item({ cost: "10", markup: "600%" })], [], 3500)[0].error).toBe("Markup is too high");
  });

  it("treats an existing cost code as a duplicate and suffixes a generated collision", () => {
    const existing = [{ id: "pb_gut", code: "GUT-DEMOLITION", name: "Gut demolition", category: "Demolition" }];
    const rows = reviewPriceBook(
      [item({ code: "gut-demolition", name: "Gut again", cost: "10" }), item({ index: 1, name: "Gut demolition", cost: "12" })],
      existing,
      3500,
    );
    expect(rows[0]).toMatchObject({ status: "duplicate", choice: "skip", detail: "Same code", matchId: "pb_gut" });
    expect(rows[1].item?.code).toBe("GUT-DEMOLITION-2");
    expect(rows[1].status).toBe("new");
    const chosen = withChoices(rows, [{ index: 1, mapToCode: "GUT-DEMOLITION", choice: "update" }], existing);
    expect(chosen[1]).toMatchObject({ choice: "update", matchId: "pb_gut" });
    expect(rowCounts(chosen)).toEqual({ new: 0, update: 1, duplicate: 1, error: 0 });
  });

  it("hides the first-proposal list only when every step is done", () => {
    const steps = [
      { id: "contacts" as const, label: "Contacts", href: "/import?kind=contacts", done: true },
      { id: "book" as const, label: "Price book", href: "/import?kind=price_book", done: true },
      { id: "job" as const, label: "First job", href: "/leads/new", done: false },
      { id: "proposal" as const, label: "First proposal", href: "/estimates", done: false },
    ];
    expect(proposalChecklist(steps)).toHaveLength(4);
    expect(proposalChecklist(steps.map((step) => ({ ...step, done: true })))).toBeNull();
  });
});
