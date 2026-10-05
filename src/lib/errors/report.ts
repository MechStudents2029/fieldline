/** Short id shown on a crash page. A Next.js digest is reused so it matches the server log. */
export function clientErrorReference(digest?: string): string {
  const clean = digest?.trim() ?? "";
  if (/^[A-Za-z0-9_-]{4,32}$/.test(clean)) return clean;
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function boundaryLogLine(input: { ref: string; path: string; message: string; digest?: string }): string {
  return JSON.stringify({
    level: "error",
    source: "fieldline",
    ref: input.ref.slice(0, 40),
    path: input.path.slice(0, 180),
    digest: input.digest?.slice(0, 40) ?? null,
    message: input.message.slice(0, 300),
  });
}
