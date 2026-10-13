import { addDays } from "@/lib/agreements/cadence";

/** A timed card with no end occupies this many minutes. Touching that end is free. */
export const DEFAULT_SPAN = 60;
export const LOOKBACK_DAYS = 7;
export const DAY_START = 7 * 60;
export const DAY_END = 18 * 60;

export type DispatchCard = {
  id: string;
  source: string;
  assigneeId: string | null;
  startMin: number | null;
  endMin: number | null;
};

export type TimeWindow = { startMin: number; endMin: number };

export type AssignResult =
  | { ok: true; next: DispatchCard[] }
  | { ok: false; code: "missing" | "window" | "overlap"; with: string[] };

export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(min: number): string {
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function lookbackStart(day: string, days = LOOKBACK_DAYS): string {
  return addDays(day, -days);
}

/** A start with no end uses DEFAULT_SPAN. An end that is not after the start is not a window. */
export function windowOf(startMin: number | null, endMin: number | null): TimeWindow | null {
  if (startMin == null) return null;
  const end = endMin == null ? startMin + DEFAULT_SPAN : endMin;
  if (end <= startMin) return null;
  return { startMin, endMin: end };
}

export function windowsOverlap(left: TimeWindow, right: TimeWindow): boolean {
  return left.startMin < right.endMin && right.startMin < left.endMin;
}

function sameSource(cards: DispatchCard[]): string[] {
  const groups = new Map<string, string[]>();
  for (const card of cards) {
    const list = groups.get(card.source) ?? [];
    list.push(card.id);
    groups.set(card.source, list);
  }
  const ids: string[] = [];
  for (const list of groups.values()) {
    if (list.length > 1) ids.push(...list);
  }
  return ids;
}

/** Cards that share a person and a clock, plus a visit listed twice. Untimed cards never overlap. */
export function overlappingIds(cards: DispatchCard[]): string[] {
  const ids = new Set<string>(sameSource(cards));
  for (let i = 0; i < cards.length; i += 1) {
    const left = cards[i]!;
    const leftWindow = left.assigneeId ? windowOf(left.startMin, left.endMin) : null;
    if (!leftWindow) continue;
    for (let j = i + 1; j < cards.length; j += 1) {
      const right = cards[j]!;
      if (right.assigneeId !== left.assigneeId) continue;
      const rightWindow = windowOf(right.startMin, right.endMin);
      if (!rightWindow || !windowsOverlap(leftWindow, rightWindow)) continue;
      ids.add(left.id);
      ids.add(right.id);
    }
  }
  return [...ids].sort();
}

/**
 * Move one card. Overlap blocks the write and leaves the list unchanged.
 * Unassign always keeps the clock. A card is not a conflict with itself.
 */
export function planAssign(cards: DispatchCard[], id: string, assigneeId: string | null, startMin: number | null, endMin: number | null): AssignResult {
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return { ok: false, code: "missing", with: [] };
  if ((startMin == null && endMin != null) || (startMin != null && endMin != null && endMin <= startMin)) {
    return { ok: false, code: "window", with: [] };
  }
  const window = assigneeId ? windowOf(startMin, endMin) : null;
  if (assigneeId && window) {
    const withIds = cards
      .filter((card) => {
        if (card.id === id || card.assigneeId !== assigneeId) return false;
        const other = windowOf(card.startMin, card.endMin);
        return Boolean(other && windowsOverlap(window, other));
      })
      .map((card) => card.id)
      .sort();
    if (withIds.length > 0) return { ok: false, code: "overlap", with: withIds };
  }
  const next = cards.map((card) => ({ ...card }));
  next[index] = { ...next[index]!, assigneeId, startMin, endMin };
  return { ok: true, next };
}
