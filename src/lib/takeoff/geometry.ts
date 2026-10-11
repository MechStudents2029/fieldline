/** Plan geometry. Points are 0–100000 across the sheet width and height. Aspect is height/width in basis points (10000 = square). */

export const PAGE = 100_000;

export type Pt = { x: number; y: number };

export type TakeoffKind = "linear" | "wall" | "area" | "count";

export type Scale =
  | {
      mode: "segment";
      ax: number;
      ay: number;
      bx: number;
      by: number;
      realInches: number;
      aspectBps: number;
    }
  | {
      mode: "preset";
      preset: string;
      paperWidthInches: number;
      aspectBps: number;
    };

export type ScalePreset = { id: string; label: string; realPerPaper: number };

/** realPerPaper is real inches per paper inch. */
export const SCALE_PRESETS: ScalePreset[] = [
  { id: "arch-1-8", label: '1/8" = 1\'', realPerPaper: 96 },
  { id: "arch-3-16", label: '3/16" = 1\'', realPerPaper: 64 },
  { id: "arch-1-4", label: '1/4" = 1\'', realPerPaper: 48 },
  { id: "arch-3-8", label: '3/8" = 1\'', realPerPaper: 32 },
  { id: "arch-1-2", label: '1/2" = 1\'', realPerPaper: 24 },
  { id: "arch-3-4", label: '3/4" = 1\'', realPerPaper: 16 },
  { id: "arch-1", label: '1" = 1\'', realPerPaper: 12 },
  { id: "eng-10", label: '1" = 10\'', realPerPaper: 120 },
  { id: "eng-20", label: '1" = 20\'', realPerPaper: 240 },
  { id: "eng-30", label: '1" = 30\'', realPerPaper: 360 },
  { id: "eng-40", label: '1" = 40\'', realPerPaper: 480 },
  { id: "eng-50", label: '1" = 50\'', realPerPaper: 600 },
];

export class TakeoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TakeoffError";
  }
}

export function sheetAspect(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 10_000;
  return Math.max(1, Math.round((height / width) * 10_000));
}

function yOf(y: number, aspectBps: number): number {
  return (y * aspectBps) / 10_000;
}

export function segmentLength(a: Pt, b: Pt, aspectBps: number): number {
  const dx = b.x - a.x;
  const dy = yOf(b.y, aspectBps) - yOf(a.y, aspectBps);
  return Math.hypot(dx, dy);
}

export function polylineLength(points: Pt[], aspectBps: number): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += segmentLength(points[index - 1]!, points[index]!, aspectBps);
  }
  return total;
}

/** Absolute polygon area in width-part squares. Shoelace, y scaled by aspect. */
export function polygonArea(points: Pt[], aspectBps: number): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]!;
    const current = points[index]!;
    sum += current.x * yOf(next.y, aspectBps) - next.x * yOf(current.y, aspectBps);
  }
  return Math.abs(sum) / 2;
}

export function pitchFactor(rise: number, run: number): number {
  if (!Number.isFinite(rise) || !Number.isFinite(run) || run <= 0 || rise < 0) throw new TakeoffError("Check the pitch.");
  return Math.hypot(rise, run) / run;
}

export function presetById(id: string): ScalePreset | null {
  return SCALE_PRESETS.find((row) => row.id === id) ?? null;
}

export function inchesPerPart(scale: Scale): number {
  const aspect = scale.aspectBps > 0 ? scale.aspectBps : 10_000;
  if (scale.mode === "preset") {
    const preset = presetById(scale.preset);
    if (!preset) throw new TakeoffError("Pick a scale.");
    const paper = scale.paperWidthInches > 0 ? scale.paperWidthInches : 36;
    return (paper * preset.realPerPaper) / PAGE;
  }
  const length = segmentLength({ x: scale.ax, y: scale.ay }, { x: scale.bx, y: scale.by }, aspect);
  if (!(length > 0) || !(scale.realInches > 0)) throw new TakeoffError("Set the scale.");
  return scale.realInches / length;
}

export function formatFeetInches(inches: number): string {
  const whole = Math.max(0, Math.round(inches));
  const feet = Math.floor(whole / 12);
  const inch = whole % 12;
  if (!inch) return `${feet}'`;
  if (!feet) return `${inch}"`;
  return `${feet}' ${inch}"`;
}

/** Bare numbers are feet. 10'6", 10-6, and 6" are feet and inches. */
export function parseFeetInches(text: string): number {
  const raw = text.trim().toLowerCase().replace(/feet/g, "'").replace(/ft/g, "'").replace(/inches/g, '"').replace(/inch/g, '"').replace(/in/g, '"').replace(/\s+/g, "");
  if (!raw) throw new TakeoffError("Enter the length.");
  const feetInches = raw.match(/^(\d+)'(\d+(?:\.\d+)?)?"?$/);
  if (feetInches) return Math.round(Number(feetInches[1]) * 12 + Number(feetInches[2] ?? 0));
  const dashed = raw.match(/^(\d+)-(\d+(?:\.\d+)?)$/);
  if (dashed) return Math.round(Number(dashed[1]) * 12 + Number(dashed[2]));
  const onlyFeet = raw.match(/^(\d+(?:\.\d+)?)'$/);
  if (onlyFeet) return Math.round(Number(onlyFeet[1]) * 12);
  const onlyInches = raw.match(/^(\d+(?:\.\d+)?)"$/);
  if (onlyInches) return Math.round(Number(onlyInches[1]));
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 12);
  throw new TakeoffError("Enter the length.");
}

export function scaleLabel(scale: Scale | null): string {
  if (!scale) return "No scale";
  if (scale.mode === "preset") return presetById(scale.preset)?.label ?? "No scale";
  return formatFeetInches(scale.realInches);
}

export function snapPoint(point: Pt, vertices: Pt[], tolerance: number): Pt {
  let best: Pt | null = null;
  let bestDist = tolerance;
  for (const vertex of vertices) {
    const dist = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (dist <= bestDist) {
      best = vertex;
      bestDist = dist;
    }
  }
  return best ?? point;
}

function qtyMilli(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new TakeoffError("The measurement is empty.");
  const milli = Math.round(value * 1000);
  if (!Number.isSafeInteger(milli) || milli <= 0) throw new TakeoffError("The measurement is empty.");
  return milli;
}

export function measureQuantity(input: {
  kind: TakeoffKind;
  points: Pt[];
  scale: Scale;
  heightInches?: number | null;
  pitchRise?: number | null;
  pitchRun?: number | null;
  depthInches?: number | null;
}): { qtyMilli: number; unit: string } {
  if (input.kind === "count") {
    if (input.points.length < 1) throw new TakeoffError("Drop a marker.");
    return { qtyMilli: input.points.length * 1000, unit: "ea" };
  }
  const per = inchesPerPart(input.scale);
  if (input.kind === "linear" || input.kind === "wall") {
    if (input.points.length < 2) throw new TakeoffError("Draw a line.");
    const inches = polylineLength(input.points, input.scale.aspectBps) * per;
    if (input.kind === "linear") return { qtyMilli: qtyMilli(inches / 12), unit: "lf" };
    const height = input.heightInches ?? 0;
    if (!(height > 0)) throw new TakeoffError("Enter the wall height.");
    return { qtyMilli: qtyMilli((inches / 12) * (height / 12)), unit: "sf" };
  }
  if (input.points.length < 3) throw new TakeoffError("Close the area.");
  let sqIn = polygonArea(input.points, input.scale.aspectBps) * per * per;
  if (input.pitchRise != null || input.pitchRun != null) {
    sqIn *= pitchFactor(input.pitchRise ?? 0, input.pitchRun ?? 0);
  }
  const depth = input.depthInches ?? 0;
  if (depth > 0) return { qtyMilli: qtyMilli((sqIn * depth) / 46_656), unit: "cy" };
  return { qtyMilli: qtyMilli(sqIn / 144), unit: "sf" };
}
