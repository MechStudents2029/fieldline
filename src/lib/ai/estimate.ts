import { suggestAssemblies, type AssemblySuggestion } from "@/lib/estimate/assembly";
import { applyCatalogQuantity, measuresFromValues } from "@/lib/estimate/formula";

export type PriceRef = {
  id?: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  unitCostCents: number;
  defaultMarkupBps: number;
  formula?: string | null;
  wasteBps?: number;
  roundToMilli?: number | null;
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
  formula?: string | null;
  wasteBps?: number;
  roundToMilli?: number | null;
};

export type DraftSection = { name: string; lines: DraftLine[] };

export type DraftMeasurement = { name: string; value: number; unit: string };

export type DraftEstimate = {
  title: string;
  sections: DraftSection[];
  notes: string;
  model: string;
  measurements: DraftMeasurement[];
  assemblies: AssemblySuggestion[];
};

/** A photo-only cue never outranks a written dimension. Estimators still have to check the site. */
export const PHOTO_ONLY_CONFIDENCE_CAP = 0.56;

export type EstimatePhoto = {
  filename: string;
  caption?: string | null;
};

type Ctx = {
  scope: string;
  photos: string;
  sqft: number | null;
  baseLf: number | null;
  explicitLf: boolean;
  explicitCounter: boolean;
  explicitCans: boolean;
  explicitFence: boolean;
};

function num(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

/** Drop the path and extension so `photos/vasquez-cabinets.svg` matches cabinet rules. */
export function cleanFilenameTokens(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base.replace(/\.[a-z0-9]{1,8}$/i, "").replace(/[^a-z0-9]+/gi, " ").trim();
}

/** `photos` wins when both are passed. Filenames alone stay valid for older callers. */
export function normalizePhotos(input: { photoNames?: string[]; photos?: EstimatePhoto[] }): EstimatePhoto[] {
  if (input.photos) {
    return input.photos.map((photo) => ({
      filename: photo.filename,
      caption: photo.caption?.trim() ? photo.caption.trim() : null,
    }));
  }
  return (input.photoNames ?? []).map((filename) => ({ filename, caption: null }));
}

function photoBlob(photos: EstimatePhoto[]): string {
  return photos
    .map((photo) => [cleanFilenameTokens(photo.filename), photo.caption?.trim() ?? ""].filter(Boolean).join(" "))
    .join(" ");
}

function buildCtx(scope: string, photos: string): Ctx {
  const sqft = num(scope, /(\d{2,5})\s*(?:sq\.?\s*ft|square feet|sqft|sf)\b/i);
  const lf = num(scope, /(\d+(?:\.\d+)?)\s*(?:linear\s*ft|lin\.?\s*ft|lf)\b/i);
  return {
    scope,
    photos,
    sqft,
    baseLf: lf,
    explicitLf: lf != null,
    explicitCounter: num(scope, /(\d+)\s*(?:sq\.?\s*ft|sf)\s*(?:of\s+)?(?:quartz|counter)/i) != null,
    explicitCans: num(scope, /(\d+)\s*(?:recessed|cans|can lights)/i) != null,
    explicitFence: num(scope, /(\d+)\s*(?:lf|linear|ft|feet)/i) != null,
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
  /** True when the quantity is a default, not a dimension written in the scope. */
  needsMeasure?: (ctx: Ctx) => boolean;
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
    needsMeasure: (c) => c.sqft == null,
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
    needsMeasure: (c) => !c.explicitLf,
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
    needsMeasure: (c) => !c.explicitLf,
  },
  {
    code: "TOP-QUARTZ",
    when: (c) => has(c, /quartz|countertop|counter top/i),
    qty: (c) => num(c.scope, /(\d+)\s*(?:sq\.?\s*ft|sf)\s*(?:of\s+)?(?:quartz|counter)/i) ?? (c.sqft ? 48 : 40),
    confidence: (c) => (inScope(c, /quartz|counter/i) ? 0.74 : 0.55),
    reason: () => "Counter area uses a typical kitchen layout until a template is measured.",
    needsMeasure: (c) => !c.explicitCounter,
  },
  {
    code: "TILE-BACK",
    when: (c) => has(c, /backsplash|tile/i) || (has(c, /kitchen/i) && has(c, /quartz|counter/i)),
    qty: () => 32,
    confidence: (c) => (inScope(c, /backsplash|tile/i) ? 0.8 : 0.6),
    reason: () => "Backsplash area is a standard 32 sq ft until field measured.",
    needsMeasure: () => true,
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
    needsMeasure: (c) => c.sqft == null,
  },
  {
    code: "FLR-HW",
    when: (c) => has(c, /hardwood|oak floor/i),
    qty: (c) => c.sqft ?? 1,
    confidence: () => 0.8,
    reason: () => "Hardwood was named in the scope.",
    needsMeasure: (c) => c.sqft == null,
  },
  {
    code: "ELE-RECESS",
    when: (c) => has(c, /recessed|can light|lighting/i),
    qty: (c) => num(c.scope, /(\d+)\s*(?:recessed|cans|can lights)/i) ?? 8,
    confidence: (c) => (inScope(c, /recessed|can light/i) ? 0.7 : 0.55),
    reason: () => "Recessed count defaults to 8 when the scope does not give a number.",
    needsMeasure: (c) => !c.explicitCans,
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
    needsMeasure: (c) => c.sqft == null,
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
    needsMeasure: (c) => c.sqft == null,
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
    needsMeasure: () => true,
  },
  {
    code: "DECK-BOARD",
    when: (c) => has(c, /deck/i),
    qty: (c) => c.sqft ?? 200,
    confidence: (c) => (c.sqft ? 0.82 : 0.55),
    reason: () => "Deck boards priced on the stated area.",
    needsMeasure: (c) => c.sqft == null,
  },
  {
    code: "DECK-RAIL",
    when: (c) => has(c, /deck|railing/i) && has(c, /deck|rail/i),
    qty: (c) => Math.max(20, Math.round(Math.sqrt(c.sqft ?? 200) * 4)),
    confidence: () => 0.5,
    reason: () => "Railing length is a rough perimeter. Measure it.",
    needsMeasure: () => true,
  },
  {
    code: "ROOF-ARCH",
    when: (c) => has(c, /roof/i),
    qty: (c) => c.sqft ?? 20,
    confidence: (c) => (c.sqft ? 0.75 : 0.5),
    reason: () => "Roofing squares were taken from the scope. 1 square = 100 sq ft if you typed squares.",
    needsMeasure: (c) => c.sqft == null,
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
    needsMeasure: (c) => !c.explicitFence,
  },
  {
    code: "ELE-PANEL",
    when: (c) => has(c, /panel/i),
    qty: () => 1,
    confidence: () => 0.8,
    reason: () => "Panel upgrade allowance. Confirm amperage on site.",
  },
];

const PHOTO_SITE_CHECK = "From a site photo, not the written scope. Needs a site check.";
const SITE_MEASURE = "Needs a site measure.";

function finishReason(rule: Rule, ctx: Ctx, photoOnly: boolean, needsMeasure: boolean): string {
  let reason = rule.reason(ctx);
  if (photoOnly && !/site photo/i.test(reason)) reason = `${reason} ${PHOTO_SITE_CHECK}`;
  if (needsMeasure && !/site measure/i.test(reason)) reason = `${reason} ${SITE_MEASURE}`;
  return reason;
}

export function measurementsFromScope(scope: string, extra: DraftMeasurement[] = []): DraftMeasurement[] {
  const ctx = buildCtx(scope, "");
  const byName = new Map<string, DraftMeasurement>();
  if (ctx.sqft) byName.set("Floor", { name: "Floor", value: ctx.sqft, unit: "sf" });
  if (ctx.baseLf != null) byName.set("Base", { name: "Base", value: ctx.baseLf, unit: "lf" });
  for (const row of extra) byName.set(row.name, row);
  return [...byName.values()];
}

/**
 * Cap a model line the same way the local matcher does when only a photo triggered the code.
 * Quantity notes stay with the local matcher, which knows whether the scope stated a dimension.
 */
export function reviewModelLine(input: {
  code: string;
  confidence: number;
  reason: string;
  scope: string;
  photos: EstimatePhoto[];
}): { confidence: number; reason: string } {
  const rule = RULES.find((item) => item.code === input.code);
  if (!rule || input.photos.length === 0) {
    return { confidence: input.confidence, reason: input.reason };
  }
  const scopeHit = rule.when(buildCtx(input.scope, ""));
  const photoHit = rule.when(buildCtx("", photoBlob(input.photos)));
  if (!photoHit || scopeHit) return { confidence: input.confidence, reason: input.reason };
  let reason = input.reason;
  if (!/site photo/i.test(reason)) reason = `${reason} ${PHOTO_SITE_CHECK}`;
  return {
    confidence: Math.round(Math.min(input.confidence, PHOTO_ONLY_CONFIDENCE_CAP) * 100) / 100,
    reason,
  };
}

export function draftEstimate(input: {
  scope: string;
  photoNames?: string[];
  photos?: EstimatePhoto[];
  book: PriceRef[];
  markupBps: number;
  model?: string;
  measurements?: DraftMeasurement[];
}): DraftEstimate {
  const photos = normalizePhotos(input);
  const ctx = buildCtx(input.scope, photoBlob(photos));
  const scopeCtx = buildCtx(input.scope, "");
  const photoCtx = buildCtx("", photoBlob(photos));
  if (ctx.baseLf == null && /cabinet/i.test(input.scope)) {
    ctx.baseLf = Math.max(10, Math.round((ctx.sqft ?? 160) * 0.08));
    scopeCtx.baseLf = ctx.baseLf;
  }
  const byCode = new Map(input.book.map((item) => [item.code, item]));
  const lines: DraftLine[] = [];
  const seen = new Set<string>();
  const measurements = measurementsFromScope(input.scope, input.measurements);
  const measureMilli = measuresFromValues(measurements);

  for (const rule of RULES) {
    if (!rule.when(ctx) || seen.has(rule.code)) continue;
    const item = byCode.get(rule.code);
    if (!item) continue;
    const guess = rule.qty(ctx);
    if (!Number.isFinite(guess) || guess <= 0) continue;
    const catalogSpec = item.formula
      ? { expr: item.formula, wasteBps: item.wasteBps ?? 0, roundToMilli: item.roundToMilli ?? null }
      : undefined;
    const applied = applyCatalogQuantity(item.code, guess, measureMilli, catalogSpec);
    const qty = applied.qty;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    seen.add(rule.code);
    const scopeHit = rule.when(scopeCtx);
    const photoHit = photos.length > 0 && rule.when(photoCtx);
    const photoOnly = photoHit && !scopeHit;
    let confidence = rule.confidence(ctx);
    if (photoOnly) confidence = Math.min(confidence, PHOTO_ONLY_CONFIDENCE_CAP);
    else if (photoHit && scopeHit) confidence = Math.min(0.95, confidence + 0.06);
    else if (photos.length > 0) confidence = Math.min(0.95, confidence + 0.03);
    const needsMeasure = applied.formula || applied.needsMeasure ? applied.needsMeasure : Boolean(rule.needsMeasure?.(ctx));
    lines.push({
      code: item.code,
      name: item.name,
      category: item.category,
      unit: item.unit,
      qty,
      unitCostCents: item.unitCostCents,
      markupBps: input.markupBps,
      confidence: Math.round(confidence * 100) / 100,
      reason: finishReason(rule, ctx, photoOnly, needsMeasure),
      priceBookItemId: item.id,
      formula: applied.formula,
      wasteBps: applied.wasteBps,
      roundToMilli: applied.roundToMilli,
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
  const measured = lines.filter((line) => /site measure/i.test(line.reason)).length;
  const captions = photos.filter((photo) => photo.caption).length;
  const photoNote =
    photos.length > 0
      ? ` ${photos.length} photo${photos.length === 1 ? "" : "s"} were used as context${
          captions > 0 ? `, including ${captions} caption${captions === 1 ? "" : "s"}` : ""
        }, not as a plan takeoff.`
      : "";
  const measureNote = measured > 0 ? ` ${measured} line${measured === 1 ? "" : "s"} need a site measure.` : "";

  return {
    title: titleFromScope(input.scope),
    sections: [...groups.entries()].map(([name, sectionLines]) => ({ name, lines: sectionLines })),
    notes: `${low} line${low === 1 ? "" : "s"} under 70% confidence.${measureNote} Prices come from your price book, not from a generic model.${photoNote} Review every line before you send.`,
    model: input.model ?? "fieldline-pricebook-v1",
    measurements,
    assemblies: suggestAssemblies(input.scope),
  };
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
