export type TrayCard = {
  id: string;
  dueOn: string;
  assigneeId: string | null;
  start: string | null;
  title: string;
};

export function shortDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

/** Cards that are not sitting on a column for this day. The toolbar and the Open list both use this. */
export function openTray<T extends TrayCard>(cards: T[], columns: { id: string }[], day: string): T[] {
  const ids = new Set(columns.map((column) => column.id));
  const placed = new Set(
    cards.filter((card) => card.dueOn === day && card.assigneeId && ids.has(card.assigneeId) && card.start).map((card) => card.id),
  );
  return cards.filter((card) => !placed.has(card.id)).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}
