import { timingSafeEqual } from "node:crypto";
import path from "node:path";

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

export function fileResponseHeaders(filename: string, body: Buffer): Headers {
  const name = downloadName(filename);
  const text = body.toString("utf8");
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; script-src 'none'; sandbox");
  headers.set("Content-Disposition", `${svgDocumentIsSafe(text) ? "inline" : "attachment"}; filename="${name}"`);
  headers.set("Content-Type", svgDocumentIsSafe(text) ? "image/svg+xml" : "application/octet-stream");
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

export function receiptUploadError(filename: string, text: string): string | null {
  if (text.length > MAX_UPLOAD_CHARS) return "Receipt files must be 1 MB or smaller.";
  const base = path.basename(filename).toLowerCase();
  if (!base || base === "." || base === "..") return "Choose a text receipt.";
  if (/\.(svg|html?|xhtml|js|mjs|pdf)$/.test(base)) return "Upload a .txt or .csv receipt.";
  if (!/\.(txt|csv|json)$/.test(base)) return "Upload a .txt or .csv receipt.";
  return null;
}
