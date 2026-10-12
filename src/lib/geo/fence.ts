/** Job-site fence. Pure: no clock, no database, no network. */

export const EARTH_RADIUS_M = 6_371_000;
export const DEFAULT_RADIUS_M = 300;
const FOOT_M = 0.3048;
const MILE_M = 1609.344;

export const GEO_MODES = ["off", "warn", "require"] as const;
export type GeoMode = (typeof GEO_MODES)[number];

export const GEO_UNITS = ["ft", "m"] as const;
export type GeoUnit = (typeof GEO_UNITS)[number];

export const GEO_VERDICTS = ["off", "skip", "no_pin", "inside", "outside", "missing", "weak"] as const;
export type GeoVerdict = (typeof GEO_VERDICTS)[number];

export type SiteEval = {
  verdict: GeoVerdict;
  distanceM: number | null;
  accuracyM: number | null;
  radiusM: number | null;
  flagged: boolean;
};

const NON_JOB = new Set(["pto", "holiday", "sick", "training"]);
const RANK: Record<string, number> = { outside: 5, weak: 4, missing: 3, no_pin: 2 };

export function isGeoMode(value: string): value is GeoMode {
  return (GEO_MODES as readonly string[]).includes(value);
}

export function isGeoUnit(value: string): value is GeoUnit {
  return (GEO_UNITS as readonly string[]).includes(value);
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function e6ToDegrees(e6: number): number {
  return e6 / 1_000_000;
}

export function degreesToE6(degrees: number): number {
  return Math.round(degrees * 1_000_000);
}

export function formatE6(e6: number): string {
  return e6ToDegrees(e6).toFixed(5);
}

export function parseAccuracy(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100_000) return null;
  return Math.round(number);
}

export function metersToUnit(meters: number, unit: GeoUnit): number {
  if (unit === "ft") return Math.round(meters / FOOT_M);
  return Math.round(meters);
}

export function unitToMeters(value: number, unit: GeoUnit): number {
  if (unit === "ft") return Math.round(value * FOOT_M);
  return Math.round(value);
}

export function formatDistance(meters: number, unit: GeoUnit): string {
  const safe = Math.max(0, meters);
  if (unit === "m") {
    if (safe >= 1000) return `${(safe / 1000).toFixed(1)} km`;
    return `${Math.round(safe)} m`;
  }
  const miles = safe / MILE_M;
  if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
  return `${Math.round(safe / FOOT_M)} ft`;
}

export function sitePill(verdict: string | null, distanceM: number | null, unit: GeoUnit): string | null {
  if (verdict === "outside") return `Outside ${formatDistance(distanceM ?? 0, unit)}`;
  if (verdict === "missing") return "No location";
  if (verdict === "weak") return "Weak GPS";
  if (verdict === "no_pin") return "No pin";
  return null;
}

export function isFlaggedVerdict(verdict: string | null): boolean {
  return verdict === "outside" || verdict === "missing" || verdict === "weak";
}

export function preferSiteLabel(current: string, next: string): string {
  const rank = (value: string) => (value.startsWith("Outside") ? 3 : value.startsWith("Weak") ? 2 : value.startsWith("No location") ? 1 : value.startsWith("No pin") ? 0 : -1);
  return rank(next) > rank(current) ? next : current;
}

export function evaluateSite(input: {
  mode: GeoMode;
  userRequiresLocation: boolean;
  projectId: string;
  shiftType: string;
  pinLatE6: number | null;
  pinLngE6: number | null;
  radiusM: number | null;
  defaultRadiusM: number;
  latE6: number | null;
  lngE6: number | null;
  accuracyM: number | null;
}): SiteEval {
  const blank = (verdict: GeoVerdict, flagged = false, radiusM: number | null = null): SiteEval => ({
    verdict,
    distanceM: null,
    accuracyM: input.accuracyM,
    radiusM,
    flagged,
  });
  if (input.mode === "off" && !input.userRequiresLocation) return blank("off");
  if (!input.projectId || NON_JOB.has(input.shiftType)) return blank("skip");
  if (input.pinLatE6 == null || input.pinLngE6 == null) return blank("no_pin");
  const radiusM = cleanRadius(input.radiusM) ?? cleanRadius(input.defaultRadiusM) ?? DEFAULT_RADIUS_M;
  if (input.latE6 == null || input.lngE6 == null) return { verdict: "missing", distanceM: null, accuracyM: input.accuracyM, radiusM, flagged: true };
  const distanceM = Math.round(
    haversineMeters(
      { lat: e6ToDegrees(input.pinLatE6), lng: e6ToDegrees(input.pinLngE6) },
      { lat: e6ToDegrees(input.latE6), lng: e6ToDegrees(input.lngE6) },
    ),
  );
  if (input.accuracyM != null && input.accuracyM > radiusM) {
    return { verdict: "weak", distanceM, accuracyM: input.accuracyM, radiusM, flagged: true };
  }
  if (distanceM > radiusM) return { verdict: "outside", distanceM, accuracyM: input.accuracyM, radiusM, flagged: true };
  return { verdict: "inside", distanceM, accuracyM: input.accuracyM, radiusM, flagged: false };
}

export function describePunch(input: {
  inVerdict: string | null;
  outVerdict: string | null;
  inDistanceM: number | null;
  outDistanceM: number | null;
  unit: GeoUnit;
  overridden: boolean;
}): { pill: string | null; overridden: boolean } {
  const edges = [
    { verdict: input.inVerdict, distanceM: input.inDistanceM },
    { verdict: input.outVerdict, distanceM: input.outDistanceM },
  ];
  const worst = edges.reduce<{ verdict: string | null; distanceM: number | null }>(
    (best, edge) => ((RANK[edge.verdict ?? ""] ?? 0) > (RANK[best.verdict ?? ""] ?? 0) ? edge : best),
    { verdict: null, distanceM: null },
  );
  if ((RANK[worst.verdict ?? ""] ?? 0) === (RANK.outside ?? 0)) {
    const outside = edges.filter((edge) => edge.verdict === "outside");
    const distanceM = outside.reduce((max, edge) => Math.max(max, edge.distanceM ?? 0), 0);
    return { pill: sitePill("outside", distanceM, input.unit), overridden: input.overridden };
  }
  return { pill: sitePill(worst.verdict, worst.distanceM, input.unit), overridden: input.overridden };
}

export function siteColumn(pill: string | null, overridden: boolean): string {
  if (pill && overridden) return `${pill} · Overridden`;
  if (pill) return pill;
  if (overridden) return "Overridden";
  return "";
}

export function sketchLayout(
  pin: { lat: number; lng: number },
  radiusM: number,
  points: { lat: number; lng: number; kind: "in" | "out" }[],
): { cx: number; cy: number; r: number; dots: { x: number; y: number; kind: "in" | "out" }[] } {
  const cx = 80;
  const cy = 56;
  const metersOf = (point: { lat: number; lng: number }) => {
    const north = ((point.lat - pin.lat) * Math.PI) / 180 * EARTH_RADIUS_M;
    const east = ((point.lng - pin.lng) * Math.PI) / 180 * EARTH_RADIUS_M * Math.cos((pin.lat * Math.PI) / 180);
    return { east, north };
  };
  const span = Math.max(radiusM, ...points.map((point) => {
    const meters = metersOf(point);
    return Math.hypot(meters.east, meters.north);
  }), 1);
  const scale = 46 / span;
  return {
    cx,
    cy,
    r: Math.max(4, radiusM * scale),
    dots: points.map((point) => {
      const meters = metersOf(point);
      return {
        x: clamp(cx + meters.east * scale, 6, 154),
        y: clamp(cy - meters.north * scale, 6, 106),
        kind: point.kind,
      };
    }),
  };
}

function cleanRadius(value: number | null): number | null {
  if (value == null || !Number.isInteger(value) || value < 10 || value > 100_000) return null;
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
