import { addWorkdays, endFromDuration, inclusiveWorkdays, type WorkdayCalendar } from "@/lib/schedule/workdays";

export type DepNode = { id: string; start: string; end: string };
export type DepEdge = { itemId: string; predecessorId: string; lag: number };
export type ScheduleShift = { id: string; start: string; end: string };

export function movesLabel(count: number): string {
  return count === 1 ? "Moves 1 item" : `Moves ${count} items`;
}

/** Finish-to-start: the next workday after the predecessor finish, plus lag workdays. */
export function fsStart(predecessorEnd: string, lag: number, mask: number | WorkdayCalendar): string {
  const gap = 1 + Math.max(0, lag);
  return addWorkdays(predecessorEnd, gap, mask);
}

export function hasCycle(edges: DepEdge[]): boolean {
  if (edges.some((edge) => edge.itemId === edge.predecessorId)) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.predecessorId) ?? [];
    list.push(edge.itemId);
    next.set(edge.predecessorId, list);
  }
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    const state = color.get(id) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(id, 1);
    for (const child of next.get(id) ?? []) {
      if (visit(child)) return true;
    }
    color.set(id, 2);
    return false;
  };
  const ids = new Set(edges.flatMap((edge) => [edge.itemId, edge.predecessorId]));
  for (const id of ids) {
    if (visit(id)) return true;
  }
  return false;
}

/**
 * Place `root` on the new dates, then pull every descendant onto its finish-to-start date.
 * A successor keeps its workday length. The returned list is every item whose dates change.
 */
export function cascadeShift(
  nodes: DepNode[],
  edges: DepEdge[],
  rootId: string,
  nextStart: string,
  nextEnd: string,
  mask: number | WorkdayCalendar,
): ScheduleShift[] {
  if (hasCycle(edges)) throw new Error("cycle");
  const original = new Map(nodes.map((node) => [node.id, { start: node.start, end: node.end }]));
  const current = new Map(nodes.map((node) => [node.id, { start: node.start, end: node.end }]));
  const root = current.get(rootId);
  if (!root) throw new Error("missing");
  root.start = nextStart;
  root.end = nextEnd;

  const children = new Map<string, string[]>();
  const incoming = new Map<string, DepEdge[]>();
  for (const edge of edges) {
    const list = children.get(edge.predecessorId) ?? [];
    list.push(edge.itemId);
    children.set(edge.predecessorId, list);
    const preds = incoming.get(edge.itemId) ?? [];
    preds.push(edge);
    incoming.set(edge.itemId, preds);
  }

  const reachable: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      reachable.push(child);
      queue.push(child);
    }
  }

  for (let pass = 0; pass < reachable.length + 1; pass += 1) {
    let changed = false;
    for (const id of reachable) {
      const node = current.get(id);
      if (!node) continue;
      let required = "";
      for (const edge of incoming.get(id) ?? []) {
        const pred = current.get(edge.predecessorId);
        if (!pred) continue;
        const start = fsStart(pred.end, edge.lag, mask);
        if (required === "" || start > required) required = start;
      }
      if (!required || required === node.start) continue;
      const duration = Math.max(1, inclusiveWorkdays(node.start, node.end, mask));
      const end = endFromDuration(required, duration, mask);
      if (node.start === required && node.end === end) continue;
      node.start = required;
      node.end = end;
      changed = true;
    }
    if (!changed) break;
  }

  const shifts: ScheduleShift[] = [];
  for (const [id, node] of current) {
    const before = original.get(id);
    if (!before) continue;
    if (before.start !== node.start || before.end !== node.end) shifts.push({ id, start: node.start, end: node.end });
  }
  return shifts;
}
