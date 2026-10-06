import { MAX_MARKUP_BPS, MAX_MONEY_CENTS, parseMoneyToCents } from "@/lib/money";
import type { ImportKind } from "@/lib/import/map";

export type RowStatus = "new" | "duplicate" | "error";
export type RowChoice = "import" | "skip" | "update";

export type ContactDraft = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  type: "client" | "sub" | "vendor";
  asLead: boolean;
};

export type ItemDraft = {
  code: string;
  name: string;
  category: string;
  categoryProvided: boolean;
  unit: string;
  unitCostCents: number;
  defaultMarkupBps: number;
};

export type ExistingContact = {
  id: string;
  type: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type ExistingItem = {
  id: string;
  code: string;
  name: string;
  category: string;
};

export type ReviewedRow = {
  index: number;
  status: RowStatus;
  choice: RowChoice;
  label: string;
  detail: string;
  error: string | null;
  matchId: string | null;
  suggestedCode: string | null;
  codeChoices: boolean;
  contact: ContactDraft | null;
  item: ItemDraft | null;
};

export type ImportCounts = { new: number; update: number; duplicate: number; error: number };

export type MappedContact = {
  index: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  type: string;
};

export type MappedItem = {
  index: number;
  name: string;
  unit: string;
  cost: string;
  price: string;
  margin: string;
  markup: string;
  code: string;
  category: string;
};

const UNITS: Record<string, string> = {
  ea: "ea",
  each: "ea",
  unit: "ea",
  sf: "sf",
  "sq ft": "sf",
  sqft: "sf",
  "square foot": "sf",
  "square feet": "sf",
  lf: "lf",
  "lin ft": "lf",
  "linear foot": "lf",
  "linear feet": "lf",
  hr: "hr",
  hour: "hr",
  hours: "hr",
  ls: "ls",
  "lump sum": "ls",
  sq: "sq",
  square: "sq",
  squares: "sq",
  cy: "cy",
  "cubic yard": "cy",
  "cubic yards": "cy",
};

export type ImportViewRow = {
  index: number;
  status: RowStatus;
  choice: RowChoice;
  label: string;
  detail: string;
  error: string | null;
  suggestedCode: string | null;
  codeChoices: boolean;
};

export type ImportHistoryRow = {
  id: string;
  kind: ImportKind;
  createdAt: string;
  undoneAt: string | null;
  summary: ImportCounts;
  reason: string | null;
};

export function toView(row: ReviewedRow): ImportViewRow {
  return {
    index: row.index,
    status: row.status,
    choice: row.choice,
    label: row.label,
    detail: row.detail,
    error: row.error,
    suggestedCode: row.suggestedCode,
    codeChoices: row.codeChoices,
  };
}

export function rowCounts(rows: { status: string; choice: string }[]): ImportCounts {
  const counts: ImportCounts = { new: 0, update: 0, duplicate: 0, error: 0 };
  for (const row of rows) {
    if (row.status === "error") counts.error += 1;
    else if (row.choice === "update") counts.update += 1;
    else if (row.status === "duplicate") counts.duplicate += 1;
    else counts.new += 1;
  }
  return counts;
}

export function reviewContacts(rows: MappedContact[], existing: ExistingContact[], kind: ImportKind): ReviewedRow[] {
  const pool = existing.filter((contact) => (kind === "vendors" ? contact.type === "sub" || contact.type === "vendor" : contact.type === "client"));
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenName = new Map<string, number>();
  return rows.map((row) => {
    const name = clean(row.name);
    if (!name) return errorRow(row.index, "Need a name");
    const email = clean(row.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorRow(row.index, "Bad email", name);
    const typed = contactType(kind, row.type);
    const draft: ContactDraft = {
      name,
      company: empty(row.company),
      email: empty(email),
      phone: empty(row.phone),
      address: empty(row.street),
      city: empty(row.city),
      state: empty(row.state),
      zip: empty(row.zip),
      notes: empty(row.notes),
      type: typed.type,
      asLead: typed.asLead,
    };
    const emailKey = normEmail(draft.email);
    const phoneKey = phoneDigits(draft.phone);
    const nameKey = normName(draft.name);
    const fileHit = (emailKey && seenEmail.get(emailKey)) ?? (phoneKey && seenPhone.get(phoneKey)) ?? (nameKey && seenName.get(nameKey));
    if (fileHit != null) {
      return duplicateRow(row.index, name, "Same file", `file:${fileHit}`, draft, null);
    }
    const match = pool.find((contact) => {
      const byEmail = emailKey && normEmail(contact.email) === emailKey;
      const byPhone = phoneKey && phoneDigits(contact.phone) === phoneKey;
      const byName = nameKey && normName(contact.name) === nameKey;
      return Boolean(byEmail || byPhone || byName);
    });
    if (emailKey) seenEmail.set(emailKey, row.index);
    if (phoneKey) seenPhone.set(phoneKey, row.index);
    if (nameKey) seenName.set(nameKey, row.index);
    if (match) {
      const detail = emailKey && normEmail(match.email) === emailKey ? "Same email" : phoneKey && phoneDigits(match.phone) === phoneKey ? "Same phone" : "Same name";
      return duplicateRow(row.index, name, detail, match.id, draft, null);
    }
    return {
      index: row.index,
      status: "new",
      choice: "import",
      label: name,
      detail: typed.asLead ? "Lead" : labelType(typed.type),
      error: null,
      matchId: null,
      suggestedCode: null,
      codeChoices: false,
      contact: draft,
      item: null,
    };
  });
}

export function reviewPriceBook(rows: MappedItem[], existing: ExistingItem[], defaultMarkupBps: number): ReviewedRow[] {
  const byCode = new Map(existing.map((item) => [item.code.toUpperCase(), item]));
  const taken = new Set(byCode.keys());
  const fileIndex = new Map<string, number>();
  return rows.map((row) => {
    const name = clean(row.name);
    if (!name) return errorRow(row.index, "Need a name");
    const unit = normalizeUnit(row.unit);
    if (!unit) return errorRow(row.index, "Unknown unit", name);
    const priced = priceDraft(row, defaultMarkupBps);
    if ("error" in priced) return errorRow(row.index, priced.error, name);
    const explicit = cleanCode(row.code);
    const code = explicit || uniqueCode(slugCode(name), taken);
    const categoryProvided = Boolean(clean(row.category));
    const category = clean(row.category) || "General";
    const known = byCode.get(code);
    const earlier = fileIndex.get(code);
    if (!explicit) taken.add(code);
    const draft: ItemDraft = {
      code,
      name,
      category,
      categoryProvided,
      unit,
      unitCostCents: priced.cost,
      defaultMarkupBps: priced.markup,
    };
    if (known || earlier != null) {
      return {
        index: row.index,
        status: "duplicate",
        choice: "skip",
        label: name,
        detail: earlier != null ? "Same file" : "Same code",
        error: null,
        matchId: known ? known.id : `file:${earlier}`,
        suggestedCode: code,
        codeChoices: false,
        contact: null,
        item: draft,
      };
    }
    fileIndex.set(code, row.index);
    if (explicit) taken.add(code);
    return {
      index: row.index,
      status: "new",
      choice: "import",
      label: name,
      detail: category,
      error: null,
      matchId: null,
      suggestedCode: code,
      codeChoices: true,
      contact: null,
      item: draft,
    };
  });
}

export function withChoices(
  rows: ReviewedRow[],
  choices: { index: number; choice?: string; mapToCode?: string }[],
  existing: ExistingItem[],
): ReviewedRow[] {
  const byCode = new Map(existing.map((item) => [item.code.toUpperCase(), item]));
  const picked = new Map(choices.map((choice) => [choice.index, choice]));
  return rows.map((row) => {
    const choice = picked.get(row.index);
    let next = row;
    const mapTo = cleanCode(choice?.mapToCode || "");
    if (mapTo && row.item && row.status !== "error") {
      const item = byCode.get(mapTo);
      if (item) {
        next = {
          ...row,
          status: "duplicate",
          choice: "update",
          matchId: item.id,
          detail: "Same code",
          codeChoices: true,
          item: { ...row.item, code: item.code },
        };
      }
    }
    if (next.status === "error") return { ...next, choice: "skip" };
    const requested = choice?.choice;
    if (next.status === "duplicate") return { ...next, choice: requested === "update" ? "update" : "skip" };
    return { ...next, choice: requested === "skip" ? "skip" : "import" };
  });
}

export function cellValue(row: string[], mapping: string[], field: string): string {
  const index = mapping.indexOf(field);
  if (index < 0) return "";
  return (row[index] || "").trim();
}

export function mapContactRow(row: string[], mapping: string[], index: number): MappedContact {
  const display = cellValue(row, mapping, "name");
  const first = cellValue(row, mapping, "first");
  const last = cellValue(row, mapping, "last");
  const company = cellValue(row, mapping, "company");
  return {
    index,
    name: display || [first, last].filter(Boolean).join(" ") || company,
    company,
    email: cellValue(row, mapping, "email"),
    phone: cellValue(row, mapping, "phone"),
    street: cellValue(row, mapping, "street"),
    city: cellValue(row, mapping, "city"),
    state: cellValue(row, mapping, "state"),
    zip: cellValue(row, mapping, "zip"),
    notes: cellValue(row, mapping, "notes"),
    type: cellValue(row, mapping, "type"),
  };
}

export function mapItemRow(row: string[], mapping: string[], index: number): MappedItem {
  return {
    index,
    name: cellValue(row, mapping, "name"),
    unit: cellValue(row, mapping, "unit"),
    cost: cellValue(row, mapping, "cost"),
    price: cellValue(row, mapping, "price"),
    margin: cellValue(row, mapping, "margin"),
    markup: cellValue(row, mapping, "markup"),
    code: cellValue(row, mapping, "code"),
    category: cellValue(row, mapping, "category"),
  };
}

function priceDraft(row: MappedItem, defaultMarkupBps: number): { cost: number; markup: number } | { error: string } {
  const cost = parseImportAmount(row.cost);
  const price = parseImportAmount(row.price);
  const margin = parsePercentBps(row.margin);
  const markup = parsePercentBps(row.markup);
  for (const parsed of [cost, price, margin, markup]) {
    if (parsed && "error" in parsed) return parsed;
  }
  const costCents = cost && "cents" in cost ? cost.cents : null;
  const priceCents = price && "cents" in price ? price.cents : null;
  const marginBps = margin && "bps" in margin ? margin.bps : null;
  const markupBps = markup && "bps" in markup ? markup.bps : null;
  if (marginBps != null && marginBps >= 10000) return { error: "Margin is too high" };
  if (markupBps != null && markupBps > MAX_MARKUP_BPS) return { error: "Markup is too high" };

  if (costCents != null && priceCents != null) return markupFrom(priceCents, costCents);
  if (costCents != null && markupBps != null) {
    const sell = Math.round((costCents * (10000 + markupBps)) / 10000);
    if (sell > MAX_MONEY_CENTS) return { error: "Over $10M" };
    return { cost: costCents, markup: markupBps };
  }
  if (costCents != null && marginBps != null) {
    const sell = Math.round((costCents * 10000) / (10000 - marginBps));
    if (sell > MAX_MONEY_CENTS) return { error: "Over $10M" };
    return markupFrom(sell, costCents);
  }
  if (costCents != null) {
    const sell = Math.round((costCents * (10000 + defaultMarkupBps)) / 10000);
    if (sell > MAX_MONEY_CENTS) return { error: "Over $10M" };
    return { cost: costCents, markup: defaultMarkupBps };
  }
  if (priceCents != null && marginBps != null) {
    const derived = Math.round((priceCents * (10000 - marginBps)) / 10000);
    return markupFrom(priceCents, derived);
  }
  return { error: "Need cost or margin" };
}

function markupFrom(price: number, cost: number): { cost: number; markup: number } | { error: string } {
  if (price > MAX_MONEY_CENTS || cost > MAX_MONEY_CENTS) return { error: "Over $10M" };
  if (price < cost) return { error: "Bad amount" };
  if (cost === 0) return price === 0 ? { cost: 0, markup: 0 } : { error: "Markup is too high" };
  const markup = Math.round(((price - cost) / cost) * 10000);
  if (markup > MAX_MARKUP_BPS) return { error: "Markup is too high" };
  return { cost, markup };
}

export function parseImportAmount(input: string): { cents: number } | { error: string } | null {
  const bare = input.trim();
  if (!bare) return null;
  const unsigned = bare.replace(/[$\s]/g, "");
  if (unsigned.startsWith("-") || (bare.startsWith("(") && bare.endsWith(")"))) return { error: "Amount is negative" };
  const cents = parseMoneyToCents(bare);
  if (cents != null) return { cents };
  const cleaned = bare.replace(/[$,\s]/g, "");
  if (/^(?:\d+|\d*\.\d{1,2})$/.test(cleaned) && Math.round(Number(cleaned) * 100) > MAX_MONEY_CENTS) return { error: "Over $10M" };
  return { error: "Bad amount" };
}

export function parsePercentBps(input: string): { bps: number } | { error: string } | null {
  const text = input.trim();
  if (!text) return null;
  if (text.startsWith("-") || (text.startsWith("(") && text.endsWith(")"))) return { error: "Amount is negative" };
  const hasPct = text.includes("%");
  const num = Number(text.replace(/[%$,\s]/g, ""));
  if (!Number.isFinite(num)) return { error: "Bad amount" };
  const percent = !hasPct && num <= 1 ? num * 100 : num;
  return { bps: Math.round(percent * 100) };
}

export function normalizeUnit(input: string): string | null {
  const key = input.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (!key) return null;
  return UNITS[key] ?? null;
}

function errorRow(index: number, error: string, label = ""): ReviewedRow {
  return {
    index,
    status: "error",
    choice: "skip",
    label,
    detail: "",
    error,
    matchId: null,
    suggestedCode: null,
    codeChoices: false,
    contact: null,
    item: null,
  };
}

function duplicateRow(index: number, label: string, detail: string, matchId: string, contact: ContactDraft | null, item: ItemDraft | null): ReviewedRow {
  return {
    index,
    status: "duplicate",
    choice: "skip",
    label,
    detail,
    error: null,
    matchId,
    suggestedCode: item?.code ?? null,
    codeChoices: false,
    contact,
    item,
  };
}

function contactType(kind: ImportKind, raw: string): { type: "client" | "sub" | "vendor"; asLead: boolean } {
  const value = raw.trim().toLowerCase();
  if (kind === "vendors") return { type: value.startsWith("sub") ? "sub" : "vendor", asLead: false };
  if (value === "lead") return { type: "client", asLead: true };
  return { type: "client", asLead: false };
}

function labelType(type: "client" | "sub" | "vendor"): string {
  if (type === "sub") return "Sub";
  if (type === "vendor") return "Vendor";
  return "Client";
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function empty(value: string): string | null {
  const next = clean(value);
  return next ? next : null;
}

export function normEmail(value: string | null | undefined): string | null {
  const next = (value || "").trim().toLowerCase();
  return next || null;
}

export function phoneDigits(value: string | null | undefined): string | null {
  let digits = (value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

export function normName(value: string | null | undefined): string | null {
  const next = (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return next || null;
}

function cleanCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function slugCode(name: string): string {
  return cleanCode(name) || "ITEM";
}

function uniqueCode(base: string, used: Set<string>): string {
  const root = base.slice(0, 32) || "ITEM";
  if (!used.has(root)) return root;
  let n = 2;
  while (n < 10000) {
    const suffix = `-${n}`;
    const next = `${root.slice(0, 32 - suffix.length)}${suffix}`;
    if (!used.has(next)) return next;
    n += 1;
  }
  return `${root.slice(0, 24)}-${n}`;
}
