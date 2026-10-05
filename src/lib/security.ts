import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { DEFAULT_TIME_ZONE, DEFAULT_WEEK_START, isValidTimeZone } from "@/lib/time/calendar";

type Env = Record<string, string | undefined>;

export const MAX_UPLOAD_CHARS = 1_000_000;

export function productionLike(env: Env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  const left = Buffer.from(token);
  const right = Buffer.from(secret);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Cron may scan every company. Production requires CRON_SECRET. Local demo stays open. */
export function cronAuthorized(
  header: string | null,
  env: Env,
): { ok: true; demo: boolean } | { ok: false } {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) {
    if (productionLike(env)) return { ok: false };
    return { ok: true, demo: true };
  }
  if (!bearerMatches(header, secret)) return { ok: false };
  return { ok: true, demo: false };
}

/**
 * Unsigned webhook posts are only for local stubbing.
 * A public deploy must set STRIPE_WEBHOOK_SECRET, or explicitly opt in.
 */
export function demoWebhookAllowed(env: Env): boolean {
  if (env.FIELDLINE_ALLOW_DEMO_WEBHOOK === "1") return true;
  return !productionLike(env);
}

export function readSessionPayload(value: unknown): { userId: string; orgId: string; exp: number } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.userId !== "string" || typeof payload.orgId !== "string") return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(payload.userId) || !/^[A-Za-z0-9_-]{1,80}$/.test(payload.orgId)) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  return { userId: payload.userId, orgId: payload.orgId, exp: payload.exp };
}

/** Same-origin demo assets only. Rejects scheme-relative and traversal paths. */
export function demoAssetPath(storagePath: string): string | null {
  if (!/^\/demo\/[A-Za-z0-9/_.-]+$/.test(storagePath)) return null;
  if (storagePath.includes("..") || storagePath.includes("//")) return null;
  return storagePath;
}

export function resolveInside(root: string, storagePath: string): string | null {
  if (!storagePath || path.isAbsolute(storagePath)) return null;
  if (storagePath.split(/[/\\]/).includes("..")) return null;
  const rootResolved = path.resolve(root);
  const file = path.resolve(rootResolved, storagePath);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (file !== rootResolved && !file.startsWith(prefix)) return null;
  return file;
}

export function fileVisible(input: { sessionOrgId: string | null; documentOrgId: string; portalMatch: boolean }): boolean {
  if (input.portalMatch) return true;
  return Boolean(input.sessionOrgId && input.sessionOrgId === input.documentOrgId);
}

/** Active SVG documents can run script when opened as a page. Only our generated notes pass. */
export function svgDocumentIsSafe(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  if (!trimmed.startsWith("<svg")) return false;
  if (trimmed.includes("<script") || trimmed.includes("javascript:") || trimmed.includes("foreignobject")) return false;
  if (/\son[a-z]+\s*=/.test(trimmed)) return false;
  if (/\s(?:href|xlink:href)\s*=/.test(trimmed)) return false;
  return true;
}

export function downloadName(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return base || "file";
}

export const MAX_PHOTO_BYTES = 2_500_000;

export type RasterType = "image/jpeg" | "image/png" | "image/webp";

/** Camera bytes are identified by magic, not the file name. */
export function rasterImageType(body: Buffer): RasterType | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 12 && body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function photoExtension(type: RasterType): "jpg" | "png" | "webp" {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "webp";
}

export function photoUploadError(filename: string, body: Buffer): string | null {
  if (body.length === 0) return "Choose a photo.";
  if (body.length > MAX_PHOTO_BYTES) return "Photos must be 2.5 MB or smaller.";
  const base = path.basename(filename).toLowerCase();
  if (/\.(svg|html?|xhtml|js|mjs|pdf)$/.test(base)) return "Use a JPEG, PNG, or WebP photo.";
  if (!rasterImageType(body)) return "Use a JPEG, PNG, or WebP photo.";
  return null;
}

export function fileResponseHeaders(filename: string, body: Buffer): Headers {
  const name = downloadName(filename);
  const raster = rasterImageType(body);
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; script-src 'none'; sandbox");
  headers.set("Cache-Control", "private, no-store");
  if (raster) {
    headers.set("Content-Disposition", `inline; filename="${name}"`);
    headers.set("Content-Type", raster);
    return headers;
  }
  const text = body.toString("utf8");
  const safeSvg = svgDocumentIsSafe(text);
  headers.set("Content-Disposition", `${safeSvg ? "inline" : "attachment"}; filename="${name}"`);
  headers.set("Content-Type", safeSvg ? "image/svg+xml" : "application/octet-stream");
  return headers;
}

export const STARTER_TRADES = ["remodel", "deck", "roofing", "general"] as const;
export type StarterTrade = (typeof STARTER_TRADES)[number];

export const STARTER_TRADE_LABELS: Record<StarterTrade, string> = {
  remodel: "Kitchen and bath remodel",
  deck: "Deck",
  roofing: "Roofing",
  general: "General",
};

export const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

const STATE_CODES = new Set(US_STATES.map((state) => state.code));

export function isStarterTrade(value: string): value is StarterTrade {
  return (STARTER_TRADES as readonly string[]).includes(value);
}

export type SignupFields = {
  ownerName: string;
  email: string;
  password: string;
  companyName: string;
  trade: StarterTrade;
  state: string;
  starter: boolean;
  timeZone?: string;
  weekStartsOn?: number;
};

export function parseSignup(input: {
  ownerName: string;
  email: string;
  password: string;
  companyName: string;
  trade: string;
  state: string;
  starter: boolean;
  timeZone?: string;
  weekStartsOn?: string | number;
}): { ok: true; value: SignupFields } | { ok: false; error: string } {
  const ownerName = cleanLabel(input.ownerName, "Your name");
  if (typeof ownerName !== "string") return ownerName;
  const companyName = cleanLabel(input.companyName, "Company name");
  if (typeof companyName !== "string") return companyName;
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email." };
  const passwordMessage = passwordError(input.password);
  if (passwordMessage) return { ok: false, error: passwordMessage };
  if (!isStarterTrade(input.trade)) return { ok: false, error: "Pick a trade." };
  const state = input.state.trim().toUpperCase();
  if (!STATE_CODES.has(state)) return { ok: false, error: "Pick a U.S. state." };
  const timeZone = (input.timeZone ?? "").trim() || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Pick a time zone." };
  let weekStartsOn = DEFAULT_WEEK_START;
  if (input.weekStartsOn !== undefined && String(input.weekStartsOn).trim() !== "") {
    weekStartsOn = Number(input.weekStartsOn);
    if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
      return { ok: false, error: "Pick the day the week starts." };
    }
  }
  return {
    ok: true,
    value: { ownerName, email, password: input.password, companyName, trade: input.trade, state, starter: input.starter, timeZone, weekStartsOn },
  };
}

function cleanLabel(value: string, label: string): string | { ok: false; error: string } {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 80) return { ok: false, error: `${label} must be 2–80 characters.` };
  if (/[\u0000-\u001f]/.test(text)) return { ok: false, error: `${label} has an invalid character.` };
  return text;
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function passwordError(password: string): string | null {
  if (password.length < 8 || password.length > 72 || !/\S/.test(password)) return "Use a password of 8 to 72 characters.";
  return null;
}

/**
 * Public origin for links we hand to people. Never read from the request Host header.
 * Production must set APP_URL. Local demo falls back to the dev port.
 */
export function appOrigin(env: Env): string | null {
  const raw = env.APP_URL?.trim();
  if (!raw) {
    if (productionLike(env)) return null;
    return "http://127.0.0.1:3847";
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Process-local. A shared demo server resets this when the process restarts. */
const WINDOW_MS = 15 * 60 * 1000;
const WINDOW_MAX = 5;
const signupBuckets = new Map<string, { start: number; count: number }>();
const acceptBuckets = new Map<string, { start: number; count: number }>();

function allowInWindow(buckets: Map<string, { start: number; count: number }>, key: string, now: number) {
  const normalized = key.trim() || "local";
  const bucket = buckets.get(normalized);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(normalized, { start: now, count: 1 });
    return true;
  }
  if (bucket.count >= WINDOW_MAX) return false;
  bucket.count += 1;
  return true;
}

export function resetSignupRateLimit() {
  signupBuckets.clear();
}

export function signupAllowed(key: string, now = Date.now()): boolean {
  return allowInWindow(signupBuckets, key, now);
}

export function resetAcceptRateLimit() {
  acceptBuckets.clear();
}

export function acceptAllowed(key: string, now = Date.now()): boolean {
  return allowInWindow(acceptBuckets, key, now);
}

export function receiptUploadError(filename: string, text: string): string | null {
  if (text.length > MAX_UPLOAD_CHARS) return "Receipt files must be 1 MB or smaller.";
  const base = path.basename(filename).toLowerCase();
  if (!base || base === "." || base === "..") return "Choose a text receipt.";
  if (/\.(svg|html?|xhtml|js|mjs|pdf)$/.test(base)) return "Upload a .txt or .csv receipt.";
  if (!/\.(txt|csv|json)$/.test(base)) return "Upload a .txt or .csv receipt.";
  return null;
}
