import { CATALOG_FORMULAS } from "@/lib/db/catalog";
import { MAX_QTY, formatQty, milliToQty, qtyToMilli } from "@/lib/money";

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

export type FormulaMeasure = { name: string; valueMilli: number };

export type FormulaInput = {
  expr: string;
  wasteBps: number;
  roundToMilli: number | null;
  measurements: FormulaMeasure[];
};

const UNITS = new Set(["sf", "lf", "ea", "sq", "cy"]);
const Z = BigInt(0);
const ONE = BigInt(1);
const NEG = BigInt(-1);
const TEN = BigInt(10);
const THOUSAND = BigInt(1000);
const TEN_THOUSAND = BigInt(10000);

type Rat = { n: bigint; d: bigint };
type Tok = { kind: "num" | "id" | "op"; value: string };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < Z ? -a : a;
  let y = b < Z ? -b : b;
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || ONE;
}

function rat(n: bigint, d: bigint): Rat {
  if (d === Z) throw new FormulaError("Can't divide by zero.");
  if (d < Z) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function add(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d);
}
function sub(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}
function mul(a: Rat, b: Rat): Rat {
  return rat(a.n * b.n, a.d * b.d);
}
function div(a: Rat, b: Rat): Rat {
  if (b.n === Z) throw new FormulaError("Can't divide by zero.");
  return rat(a.n * b.d, a.d * b.n);
}

function parseNumber(text: string): Rat {
  if (!/^\d+(\.\d+)?$/.test(text)) throw new FormulaError("Check the formula.");
  const [whole, frac = ""] = text.split(".");
  return rat(BigInt(whole + frac), TEN ** BigInt(frac.length));
}

function tokenize(input: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === " " || c === "\t") {
      i += 1;
      continue;
    }
    if ("+-*/()".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j += 1;
      tokens.push({ kind: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9]/.test(input[j]!)) j += 1;
      tokens.push({ kind: "id", value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new FormulaError("Check the formula.");
  }
  return tokens;
}

class Parser {
  private i = 0;
  constructor(private tokens: Tok[]) {}

  parse(): { value: (measures: Map<string, Rat>) => Rat; names: string[] } {
    if (this.tokens.length === 0) throw new FormulaError("Check the formula.");
    const names: string[] = [];
    const value = this.expr(names);
    if (this.i < this.tokens.length) throw new FormulaError("Check the formula.");
    return { value, names };
  }

  private peek(): Tok | undefined {
    return this.tokens[this.i];
  }

  private eat(value: string): boolean {
    if (this.peek()?.kind === "op" && this.peek()?.value === value) {
      this.i += 1;
      return true;
    }
    return false;
  }

  private expr(names: string[]): (measures: Map<string, Rat>) => Rat {
    let left = this.term(names);
    while (this.peek()?.kind === "op" && (this.peek()?.value === "+" || this.peek()?.value === "-")) {
      const op = this.peek()!.value;
      this.i += 1;
      const right = this.term(names);
      const prev = left;
      left = (measures) => (op === "+" ? add(prev(measures), right(measures)) : sub(prev(measures), right(measures)));
    }
    return left;
  }

  private term(names: string[]): (measures: Map<string, Rat>) => Rat {
    let left = this.unary(names);
    while (this.peek()?.kind === "op" && (this.peek()?.value === "*" || this.peek()?.value === "/")) {
      const op = this.peek()!.value;
      this.i += 1;
      const right = this.unary(names);
      const prev = left;
      left = (measures) => (op === "*" ? mul(prev(measures), right(measures)) : div(prev(measures), right(measures)));
    }
    return left;
  }

  private unary(names: string[]): (measures: Map<string, Rat>) => Rat {
    if (this.eat("-")) {
      const inner = this.unary(names);
      return (measures) => mul(inner(measures), rat(NEG, ONE));
    }
    if (this.eat("+")) return this.unary(names);
    return this.primary(names);
  }

  private primary(names: string[]): (measures: Map<string, Rat>) => Rat {
    const tok = this.peek();
    if (!tok) throw new FormulaError("Check the formula.");
    if (tok.kind === "op" && tok.value === "(") {
      this.i += 1;
      const inner = this.expr(names);
      if (!this.eat(")")) throw new FormulaError("Check the formula.");
      return inner;
    }
    if (tok.kind === "num") {
      this.i += 1;
      const value = parseNumber(tok.value);
      return () => value;
    }
    if (tok.kind === "id") {
      this.i += 1;
      if (!names.includes(tok.value)) names.push(tok.value);
      const name = tok.value;
      return (measures) => {
        const found = measures.get(name);
        if (!found) throw new FormulaError(`Unknown measurement ${name}.`);
        return found;
      };
    }
    throw new FormulaError("Check the formula.");
  }
}

export function parseFormula(expr: string): { names: string[] } {
  const parsed = new Parser(tokenize(expr.trim())).parse();
  return { names: parsed.names };
}

export function referencedNames(expr: string): string[] {
  return parseFormula(expr).names;
}

function ceilDiv(n: bigint, d: bigint): bigint {
  if (d <= Z || n <= Z) throw new FormulaError("Quantity must be greater than zero.");
  return (n + d - ONE) / d;
}

/** Quantity in milli-units after waste, rounded up, then ready for cent math. */
export function evaluateFormula(input: FormulaInput): number {
  const expr = input.expr.trim();
  if (!expr || expr.length > 80) throw new FormulaError("Check the formula.");
  if (!Number.isSafeInteger(input.wasteBps) || input.wasteBps < 0 || input.wasteBps > 10_000) {
    throw new FormulaError("Check the formula.");
  }
  if (input.roundToMilli != null && (!Number.isSafeInteger(input.roundToMilli) || input.roundToMilli <= 0)) {
    throw new FormulaError("Check the formula.");
  }
  const parsed = new Parser(tokenize(expr)).parse();
  const measures = new Map<string, Rat>();
  for (const row of input.measurements) {
    if (!Number.isSafeInteger(row.valueMilli)) throw new FormulaError("Check the formula.");
    measures.set(row.name, rat(BigInt(row.valueMilli), THOUSAND));
  }
  let value = parsed.value(measures);
  if (input.wasteBps > 0) value = mul(value, rat(BigInt(10_000 + input.wasteBps), TEN_THOUSAND));
  if (value.n <= Z) throw new FormulaError("Quantity must be greater than zero.");
  const cap = BigInt(MAX_QTY * 1000);
  const qty = input.roundToMilli
    ? ceilDiv(value.n * THOUSAND, value.d * BigInt(input.roundToMilli)) * BigInt(input.roundToMilli)
    : ceilDiv(value.n * THOUSAND, value.d);
  if (qty <= Z || qty > cap) throw new FormulaError("Quantity must be greater than zero.");
  return Number(qty);
}

/** Plain quantity: `410 sf × 1.10 → 451, rounded to 480 (15 × 32 sf)`. */
export function formulaHint(input: FormulaInput & { unit?: string }): string {
  try {
    const names = referencedNames(input.expr);
    const single = names.length === 1 && input.expr.trim() === names[0];
    const measure = single ? input.measurements.find((row) => row.name === names[0]) : undefined;
    const unit = (input.unit ?? "").trim();
    const wasted = evaluateFormula({ ...input, roundToMilli: null });
    const finalQty = evaluateFormula(input);
    const head = measure
      ? `${formatQty(measure.valueMilli)}${unit ? ` ${unit}` : ""}`
      : input.expr.trim().replace(/\s*\*\s*/g, " × ");
    const times = input.wasteBps > 0 ? `${head} × ${(1 + input.wasteBps / 10_000).toFixed(2)}` : head;
    if (input.roundToMilli && input.roundToMilli > 0) {
      const packs = Math.round((finalQty / input.roundToMilli) * 1000);
      const pack = `${formatQty(packs)} × ${formatQty(input.roundToMilli)}${unit ? ` ${unit}` : ""}`;
      return `${times} → ${formatQty(wasted)}, rounded to ${formatQty(finalQty)} (${pack})`;
    }
    return `${times} → ${formatQty(finalQty)}`;
  } catch {
    return formulaCaption(input.expr, input.wasteBps, input.roundToMilli);
  }
}

export function formulaCaption(expr: string, wasteBps: number, roundToMilli: number | null): string {
  const trimmed = expr.trim();
  const single = /^[A-Za-z][A-Za-z0-9]*$/.test(trimmed);
  const head =
    single && wasteBps > 0
      ? `${trimmed} x ${(1 + wasteBps / 10_000).toFixed(2)}`
      : wasteBps > 0
        ? `${trimmed.replace(/\s*\*\s*/g, " x ").replace(/\s+/g, " ")}, +${(wasteBps / 100).toFixed(wasteBps % 100 === 0 ? 0 : 1)}%`
        : trimmed.replace(/\s*\*\s*/g, " x ").replace(/\s+/g, " ");
  if (roundToMilli && roundToMilli > 0) return `${head}, round up to ${formatQty(roundToMilli)}`;
  return head;
}

export function measurementUnit(unit: string): string {
  const next = unit.trim().toLowerCase();
  if (!UNITS.has(next)) throw new FormulaError("Unit must be sf, lf, ea, sq, or cy.");
  return next;
}

export function measurementName(name: string): string {
  const next = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(next)) throw new FormulaError("Name the measurement with letters and numbers.");
  return next;
}

export function qtyFromMilli(milli: number): number {
  return milliToQty(milli);
}

export function applyCatalogQuantity(
  code: string,
  guessQty: number,
  measurements: FormulaMeasure[],
  spec: { expr: string; wasteBps: number; roundToMilli: number | null } | undefined = CATALOG_FORMULAS[code],
): { qty: number; formula: string | null; wasteBps: number; roundToMilli: number | null; needsMeasure: boolean } {
  if (!spec) return { qty: guessQty, formula: null, wasteBps: 0, roundToMilli: null, needsMeasure: false };
  const names = referencedNames(spec.expr);
  if (names.some((name) => !measurements.some((row) => row.name === name))) {
    return { qty: guessQty, formula: null, wasteBps: 0, roundToMilli: null, needsMeasure: true };
  }
  const qtyMilli = evaluateFormula({
    expr: spec.expr,
    wasteBps: spec.wasteBps,
    roundToMilli: spec.roundToMilli,
    measurements,
  });
  return { qty: milliToQty(qtyMilli), formula: spec.expr, wasteBps: spec.wasteBps, roundToMilli: spec.roundToMilli, needsMeasure: false };
}

export function measuresFromValues(rows: { name: string; value: number }[]): FormulaMeasure[] {
  return rows.map((row) => ({ name: row.name, valueMilli: qtyToMilli(row.value) }));
}
