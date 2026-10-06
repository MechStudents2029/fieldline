export type ImportKind = "contacts" | "vendors" | "price_book";

export const CONTACT_FIELDS = ["name", "company", "first", "last", "email", "phone", "street", "city", "state", "zip", "notes", "type"] as const;
export const PRICE_FIELDS = ["name", "unit", "cost", "price", "margin", "markup", "code", "category"] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];
export type PriceField = (typeof PRICE_FIELDS)[number];

const CONTACT_SYNONYMS: Record<ContactField, string[]> = {
  name: ["display name", "contact name", "full name", "customer name", "client name", "contact", "customer", "client", "name"],
  company: ["company name", "customer company", "company"],
  first: ["first name", "given name", "firstname"],
  last: ["last name", "family name", "surname", "lastname"],
  email: ["email address", "e-mail", "email"],
  phone: ["primary phone", "phone numbers", "mobile phone", "cell phone", "phone", "mobile", "cell"],
  street: ["billing street", "street address", "billing address", "address line 1", "address", "street"],
  city: ["billing city", "city"],
  state: ["billing state", "billing province", "state"],
  zip: ["billing postal code", "billing zip", "postal code", "zip code", "zip"],
  notes: ["notes", "note", "memo"],
  type: ["contact type", "type"],
};

const PRICE_SYNONYMS: Record<PriceField, string[]> = {
  name: ["item name", "description", "item", "name"],
  unit: ["unit of measure", "uom", "unit"],
  cost: ["unit cost", "cost"],
  price: ["sales price", "sell price", "unit price", "price"],
  margin: ["target margin", "gross margin", "margin"],
  markup: ["default markup", "markup"],
  code: ["cost code", "item code", "code", "sku"],
  category: ["category", "cost group", "group"],
};

export const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  company: "Company",
  first: "First name",
  last: "Last name",
  email: "Email",
  phone: "Phone",
  street: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
  notes: "Notes",
  type: "Type",
  unit: "Unit",
  cost: "Unit cost",
  price: "Price",
  margin: "Margin",
  markup: "Markup",
  code: "Cost code",
  category: "Category",
};

export function isImportKind(value: string): value is ImportKind {
  return value === "contacts" || value === "vendors" || value === "price_book";
}

export function fieldsFor(kind: ImportKind): readonly string[] {
  return kind === "price_book" ? PRICE_FIELDS : CONTACT_FIELDS;
}

export function autoMap(headers: string[], kind: ImportKind): string[] {
  const fields = fieldsFor(kind);
  const synonyms = kind === "price_book" ? PRICE_SYNONYMS : CONTACT_SYNONYMS;
  const candidates: { col: number; field: string; score: number }[] = [];
  headers.forEach((header, col) => {
    const normalized = normHeader(header);
    if (!normalized) return;
    for (const field of fields) {
      let best = 0;
      for (const synonym of synonyms[field as keyof typeof synonyms]) {
        best = Math.max(best, scoreHeader(normalized, synonym));
      }
      if (best > 0) candidates.push({ col, field, score: best });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.col - b.col);
  const usedCol = new Set<number>();
  const usedField = new Set<string>();
  const mapping = headers.map(() => "");
  for (const candidate of candidates) {
    if (usedCol.has(candidate.col) || usedField.has(candidate.field)) continue;
    usedCol.add(candidate.col);
    usedField.add(candidate.field);
    mapping[candidate.col] = candidate.field;
  }
  return mapping;
}

export function csvTemplate(kind: ImportKind): string {
  if (kind === "vendors") return "Name,Company,Email,Phone,Address,City,State,Zip,Type\n";
  if (kind === "price_book") return "Name,Unit,Unit Cost,Price,Margin,Cost Code,Category\n";
  return "Display Name,Company,First Name,Last Name,Email,Phone,Billing Street,Billing City,Billing State,Billing ZIP,Type\n";
}

export function templateName(kind: ImportKind): string {
  if (kind === "vendors") return "vendors.csv";
  if (kind === "price_book") return "price-book.csv";
  return "contacts.csv";
}

function normHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreHeader(header: string, synonym: string): number {
  if (header === synonym) return 3;
  if (synonym.length < 5) return 0;
  const pattern = new RegExp(`(?:^|\\s)${synonym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`);
  return pattern.test(header) ? 2 : 0;
}
