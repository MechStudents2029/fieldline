export function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || "").trim();
}

export function readQuery(input: URLSearchParams | Record<string, string | string[] | undefined>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = input instanceof URLSearchParams ? (input.get(key) || "").trim() : one(input[key]);
    if (value) out[key] = value;
  }
  return out;
}

export function writeQuery(path: string, query: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function withPatch(path: string, current: Record<string, string>, patch: Record<string, string | null>): string {
  const next: Record<string, string> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!value) delete next[key];
    else next[key] = value;
  }
  return writeQuery(path, next);
}

export function pinnedTarget(
  path: string,
  raw: Record<string, string | string[] | undefined>,
  pin: { id: string; query: Record<string, string>; sortKey?: string | null; sortDir?: string | null } | null,
  filterKeys: string[],
  keep: string[] = [],
): string | null {
  if (!pin) return null;
  if (one(raw.view)) return null;
  if (filterKeys.some((key) => one(raw[key]))) return null;
  if (keep.some((key) => one(raw[key]))) return null;
  return writeQuery(path, {
    ...pin.query,
    view: pin.id,
    ...(pin.sortKey ? { sort: pin.sortKey } : {}),
    ...(pin.sortDir ? { dir: pin.sortDir } : {}),
  });
}
