export type PriceRef = {
  id?: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  unitCostCents: number;
  defaultMarkupBps: number;
};

export type DraftLine = {
  code: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  unitCostCents: number;
  markupBps: number;
  confidence: number;
  reason: string;
  priceBookItemId?: string;
};

export type DraftSection = { name: string; lines: DraftLine[] };

export type DraftEstimate = {
  title: string;
  sections: DraftSection[];
  notes: string;
  model: string;
};

type Ctx = {
  scope: string;
  photos: string;
  sqft: number | null;
  baseLf: number | null;
  explicitLf: boolean;
};

function num(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function buildCtx(scope: string, photoNames: string[]): Ctx {
  const photos = photoNames.join(" ");
  const sqft = num(scope, /(\d{2,5})\s*(?:sq\.?\s*ft|square feet|sqft|sf)\b/i);
  const lf = num(scope, /(\d+(?:\.\d+)?)\s*(?:linear\s*ft|lin\.?\s*ft|lf)\b/i);
  return {
    scope,
    photos,
    sqft,
    baseLf: lf,
    explicitLf: lf != null,
  };
}

function has(ctx: Ctx, pattern: RegExp): boolean {
  return pattern.test(ctx.scope) || pattern.test(ctx.photos);
}

function inScope(ctx: Ctx, pattern: RegExp): boolean {
  return pattern.test(ctx.scope);
}

type Rule = {
  code: string;
  when: (ctx: Ctx) => boolean;
  qty: (ctx: Ctx) => number;
  confidence: (ctx: Ctx) => number;
  reason: (ctx: Ctx) => string;
};

const RULES: Rule[] = [
  {
    code: "DEMO-GUT",
    when: (c) => has(c, /gut|demolish|demo\b|tear[\s-]?out/i),
    qty: (c) => c.sqft ?? 1,
    confidence: (c) => (c.sqft ? 0.84 : 0.6),
    reason: (c) =>
      c.sqft
        ? `Gut demolition priced per sq ft from the ${c.sqft} sq ft in the scope.`
        : "Demolition mentioned, but no area was given.",
  },
  {
    code: "DEMO-HAUL",
    when: (c) => has(c, /gut|demo\b|haul/i),
    qty: () => 1,
    confidence: () => 0.78,
    reason: () => "Haul-off is included on gut remodels in this price book.",
  },
  {
    code: "CAB-BASE",
    when: (c) => has(c, /cabinet/i),
    qty: (c) => c.baseLf ?? Math.max(10, Math.round((c.sqft ?? 160) * 0.08)),
    confidence: (c) => (c.explicitLf ? 0.9 : 0.58),
    reason: (c) =>
      c.explicitLf
        ? `Base cabinets use the ${c.baseLf} linear ft written in the scope.`
        : "Base cabinet length was inferred from the room size. Confirm on site.",
  },
  {
    code: "CAB-UPPER",
    when: (c) => has(c, /cabinet/i),
    qty: (c) => {
      const base = c.baseLf ?? Math.max(10, Math.round((c.sqft ?? 160) * 0.08));
      return Math.max(6, Math.round(base * 0.85));
    },
    confidence: (c) => (c.explicitLf ? 0.72 : 0.5),
    reason: () => "Uppers are estimated at 85% of the base-cabinet run.",
  },
  {
    code: "TOP-QUARTZ",
    when: (c) => has(c, /quartz|countertop|counter top/i),
    qty: (c) => num(c.scope, /(\d+)\s*(?:sq\.?\s*ft|sf)\s*(?:of\s+)?(?:quartz|counter)/i) ?? (c.sqft ? 48 : 40),
    confidence: (c) => (inScope(c, /quartz|counter/i) ? 0.74 : 0.55),
    reason: () => "Counter area uses a typical kitchen layout until a template is measured.",
  },
  {
    code: "TILE-BACK",
    when: (c) => has(c, /backsplash|tile/i) || (has(c, /kitchen/i) && has(c, /quartz|counter/i)),
    qty: () => 32,
    confidence: (c) => (inScope(c, /backsplash|tile/i) ? 0.8 : 0.6),
    reason: () => "Backsplash area is a standard 32 sq ft until field measured.",
  },
  {
    code: "FLR-LVP",
    when: (c) => has(c, /lvp|vinyl|floor/i) || (has(c, /kitchen|gut/i) && !has(c, /keep (the )?floor|hardwood/i)),
    qty: (c) => c.sqft ?? 1,
    confidence: (c) => (inScope(c, /floor|lvp|vinyl/i) ? 0.82 : 0.58),
    reason: (c) =>
      inScope(c, /floor|lvp|vinyl/i)
        ? "Flooring area follows the room size in the scope."
        : "Gut kitchen assumes new LVP. Remove this line if the floor stays.",
  },
  {
    code: "FLR-HW",
    when: (c) => has(c, /hardwood|oak floor/i),
    qty: (c) => c.sqft ?? 1,
    confidence: () => 0.8,
    reason: () => "Hardwood was named in the scope.",
  },
  {
    code: "ELE-RECESS",
    when: (c) => has(c, /recessed|can light|lighting/i),
    qty: (c) => num(c.scope, /(\d+)\s*(?:recessed|cans|can lights)/i) ?? 8,
    confidence: (c) => (inScope(c, /recessed|can light/i) ? 0.7 : 0.55),
    reason: () => "Recessed count defaults to 8 when the scope does not give a number.",
  },
  {
    code: "ELE-KIT",
    when: (c) => has(c, /kitchen|electrical|circuit/i),
    qty: () => 1,
    confidence: (c) => (inScope(c, /electrical|circuit|light/i) ? 0.76 : 0.64),
    reason: () => "Kitchen electrical package from the price book (circuits, devices, disconnects).",
  },
  {
    code: "PLB-SINK",
    when: (c) => has(c, /relocat|plumb|sink/i),
    qty: () => 1,
    confidence: (c) => (inScope(c, /relocat/i) ? 0.86 : 0.66),
    reason: (c) =>
      inScope(c, /relocat/i)
        ? "Sink relocation was written into the scope."
        : "A sink reset is included because plumbing was mentioned.",
  },
  {
    code: "PLB-DISH",
    when: (c) => has(c, /dishwasher|kitchen/i),
    qty: () => 1,
    confidence: () => 0.63,
    reason: () => "Dishwasher connection is a common kitchen allowance. Confirm the appliance list.",
  },
  {
    code: "DW-HANG",
    when: (c) => has(c, /drywall|gut|demo\b/i),
    qty: (c) => (c.sqft ? c.sqft * 2 : 200),
    confidence: (c) => (c.sqft ? 0.68 : 0.5),
    reason: () => "Wall and ceiling area is estimated at twice the floor area after a gut.",
  },
  {
    code: "PNT-INT",
    when: (c) => has(c, /paint|gut|kitchen|bath/i),
    qty: (c) => (c.sqft ? c.sqft * 2 : 200),
    confidence: (c) => (inScope(c, /paint/i) ? 0.8 : 0.62),
    reason: (c) =>
      inScope(c, /paint/i)
        ? "Paint area follows the room size."
        : "Paint is included as a finish allowance.",
  },
  {
    code: "APP-ALLOW",
    when: (c) => has(c, /appliance|kitchen/i) && !has(c, /no appliance|appliances by owner|owner.?supplied appliance/i),
    qty: () => 1,
    confidence: () => 0.6,
    reason: () => "Appliance allowance. Replace with the homeowner's model list before sending.",
  },
  {
    code: "PERMIT-RES",
    when: (c) => has(c, /permit|gut|kitchen|bath|addition|panel/i),
    qty: () => 1,
    confidence: (c) => (inScope(c, /permit/i) ? 0.84 : 0.66),
    reason: () => "Residential permit allowance from the price book.",
  },
  {
    code: "GC-SUPER",
    when: (c) => has(c, /kitchen|bath|addition|remodel|gut/i),
    qty: () => 1,
    confidence: () => 0.8,
    reason: () => "Supervision and job setup from the price book.",
  },
  {
    code: "BATH-VANITY",
    when: (c) => has(c, /vanity|bath/i) && !has(c, /kitchen/i),
    qty: () => 1,
    confidence: () => 0.7,
    reason: () => "One vanity allowance until a model is chosen.",
  },
  {
    code: "TILE-SHOWER",
    when: (c) => has(c, /shower/i),
    qty: () => 80,
    confidence: () => 0.64,
    reason: () => "Shower wall tile defaults to 80 sq ft.",
  },
  {
    code: "DECK-BOARD",
    when: (c) => has(c, /deck/i),
    qty: (c) => c.sqft ?? 200,
    confidence: (c) => (c.sqft ? 0.82 : 0.55),
    reason: () => "Deck boards priced on the stated area.",
  },
  {
    code: "DECK-RAIL",
    when: (c) => has(c, /deck|railing/i) && has(c, /deck|rail/i),
    qty: (c) => Math.max(20, Math.round(Math.sqrt(c.sqft ?? 200) * 4)),
    confidence: () => 0.5,
    reason: () => "Railing length is a rough perimeter. Measure it.",
  },
  {
    code: "ROOF-ARCH",
    when: (c) => has(c, /roof/i),
    qty: (c) => c.sqft ?? 20,
    confidence: (c) => (c.sqft ? 0.75 : 0.5),
    reason: () => "Roofing squares were taken from the scope. 1 square = 100 sq ft if you typed squares.",
  },
  {
    code: "PNT-EXT",
    when: (c) => has(c, /exterior paint|paint the (house|exterior)/i),
    qty: () => 1,
    confidence: () => 0.6,
    reason: () => "Exterior paint package. Walk the elevation before sending.",
  },
  {
    code: "FENCE-WOOD",
    when: (c) => has(c, /fence/i),
    qty: (c) => num(c.scope, /(\d+)\s*(?:lf|linear|ft|feet)/i) ?? 80,
    confidence: () => 0.66,
    reason: () => "Fence length from the scope, or 80 ft if none was given.",
  },
  {
    code: "ELE-PANEL",
    when: (c) => has(c, /panel/i),
    qty: () => 1,
    confidence: () => 0.8,
    reason: () => "Panel upgrade allowance. Confirm amperage on site.",
  },
];

export function draftEstimate(input: {
  scope: string;
  photoNames?: string[];
  book: PriceRef[];
  markupBps: number;
  model?: string;
}): DraftEstimate {
  const ctx = buildCtx(input.scope, input.photoNames ?? []);
  if (ctx.baseLf == null && /cabinet/i.test(input.scope)) {
    ctx.baseLf = Math.max(10, Math.round((ctx.sqft ?? 160) * 0.08));
  }
  const byCode = new Map(input.book.map((item) => [item.code, item]));
  const lines: DraftLine[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (!rule.when(ctx) || seen.has(rule.code)) continue;
    const item = byCode.get(rule.code);
    if (!item) continue;
    const qty = rule.qty(ctx);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    seen.add(rule.code);
    const photoOnly = !ruleMatchesScope(rule, input.scope) && (input.photoNames?.length ?? 0) > 0;
    let confidence = rule.confidence(ctx);
    if (photoOnly) confidence = Math.min(confidence, 0.56);
    if ((input.photoNames?.length ?? 0) > 0 && !photoOnly) {
      confidence = Math.min(0.95, confidence + 0.03);
    }
    lines.push({
      code: item.code,
      name: item.name,
      category: item.category,
      unit: item.unit,
      qty,
      unitCostCents: item.unitCostCents,
      markupBps: input.markupBps,
      confidence: Math.round(confidence * 100) / 100,
      reason: rule.reason(ctx),
      priceBookItemId: item.id,
    });
  }

  if (lines.length === 0) {
    const fallback = byCode.get("GC-SUPER");
    if (fallback) {
      lines.push({
        code: fallback.code,
        name: fallback.name,
        category: fallback.category,
        unit: fallback.unit,
        qty: 1,
        unitCostCents: fallback.unitCostCents,
        markupBps: input.markupBps,
        confidence: 0.35,
        reason: "No price-book pattern matched this scope. Add lines before sending.",
        priceBookItemId: fallback.id,
      });
    }
  }

  const groups = new Map<string, DraftLine[]>();
  for (const line of lines) {
    const list = groups.get(line.category) ?? [];
    list.push(line);
    groups.set(line.category, list);
  }

  const low = lines.filter((line) => line.confidence < 0.7).length;
  const photoNote =
    (input.photoNames?.length ?? 0) > 0
      ? ` ${input.photoNames!.length} photo${input.photoNames!.length === 1 ? "" : "s"} were used as context, not as a plan takeoff.`
      : "";

  return {
    title: titleFromScope(input.scope),
    sections: [...groups.entries()].map(([name, sectionLines]) => ({ name, lines: sectionLines })),
    notes: `${low} line${low === 1 ? "" : "s"} under 70% confidence. Prices come from your price book, not from a generic model.${photoNote} Review every line before you send.`,
    model: input.model ?? "fieldline-pricebook-v1",
  };
}

function ruleMatchesScope(rule: Rule, scope: string): boolean {
  const onlyPhotos: Ctx = { scope: "", photos: "", sqft: null, baseLf: null, explicitLf: false };
  const withScope: Ctx = { scope, photos: "", sqft: null, baseLf: null, explicitLf: false };
  return rule.when(withScope) || !rule.when(onlyPhotos);
}

function titleFromScope(scope: string): string {
  const lower = scope.toLowerCase();
  if (lower.includes("kitchen")) return "Kitchen remodel";
  if (lower.includes("bath")) return "Bath remodel";
  if (lower.includes("deck")) return "Deck";
  if (lower.includes("roof")) return "Roof";
  if (lower.includes("fence")) return "Fence";
  if (lower.includes("basement")) return "Basement remodel";
  if (lower.includes("addition") || lower.includes("adu")) return "Addition";
  return "Remodel estimate";
}

export function draftToTotals(
  draft: DraftEstimate,
  lineAmounts: (qtyMilli: number, unitCost: number, markupBps: number) => { cost: number; price: number },
  qtyToMilli: (qty: number) => number,
) {
  let cost = 0;
  let price = 0;
  for (const section of draft.sections) {
    for (const line of section.lines) {
      const amounts = lineAmounts(qtyToMilli(line.qty), line.unitCostCents, line.markupBps);
      cost += amounts.cost;
      price += amounts.price;
    }
  }
  return { cost, price };
}
