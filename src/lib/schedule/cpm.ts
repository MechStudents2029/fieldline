import { hasCycle, type DepEdge, type DepNode } from "@/lib/schedule/deps";
import { addWorkdays, inclusiveWorkdays, snapWorkday, workdayOffset, type WorkdayCalendar } from "@/lib/schedule/workdays";

export type CpmNode = DepNode;
export type CpmEdge = DepEdge;

export type CpmItem = {
  id: string;
  float: number;
  critical: boolean;
};

export type CpmResult = {
  finish: string;
  items: CpmItem[];
};

/**
 * Total float from the scheduled dates, finish-to-start links, lag, and the workday calendar.
 * The job finish is the latest scheduled end. An item is critical when it has no float.
 * A cycle is refused.
 */
export function criticalPath(nodes: CpmNode[], edges: CpmEdge[], calendar: number | WorkdayCalendar): CpmResult {
  const known = new Set(nodes.map((node) => node.id));
  const links = edges.filter((edge) => known.has(edge.itemId) && known.has(edge.predecessorId));
  if (hasCycle(links)) throw new Error("cycle");
  if (nodes.length === 0) return { finish: "", items: [] };

  const children = new Map<string, { id: string; lag: number }[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of links) {
    const list = children.get(edge.predecessorId) ?? [];
    list.push({ id: edge.itemId, lag: Math.max(0, edge.lag) });
    children.set(edge.predecessorId, list);
    indegree.set(edge.itemId, (indegree.get(edge.itemId) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child.id) ?? 0) - 1;
      indegree.set(child.id, next);
      if (next === 0) queue.push(child.id);
    }
  }
  if (order.length !== nodes.length) throw new Error("cycle");

  const duration = new Map(nodes.map((node) => [node.id, Math.max(1, inclusiveWorkdays(node.start, node.end, calendar))]));
  const earlyFinish = new Map(nodes.map((node) => [node.id, node.end]));
  const finish = nodes.reduce((max, node) => (node.end > max ? node.end : max), nodes[0]!.end);

  const lateStart = new Map<string, string>();
  const lateFinish = new Map<string, string>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index]!;
    const successors = children.get(id) ?? [];
    let latest = finish;
    if (successors.length > 0) {
      latest = "";
      for (const successor of successors) {
        const start = lateStart.get(successor.id);
        if (!start) continue;
        const end = addWorkdays(start, -(1 + successor.lag), calendar);
        if (latest === "" || end < latest) latest = end;
      }
      if (!latest) latest = finish;
    }
    lateFinish.set(id, latest);
    const days = duration.get(id) ?? 1;
    const snapped = snapWorkday(latest, calendar, latest >= (earlyFinish.get(id) ?? latest) ? -1 : 1);
    lateStart.set(id, days <= 1 ? snapped : addWorkdays(snapped, -(days - 1), calendar));
  }

  const items = nodes.map((node) => {
    const early = earlyFinish.get(node.id) ?? node.end;
    const late = lateFinish.get(node.id) ?? finish;
    let float = 0;
    if (late > early) float = workdayOffset(early, late, calendar);
    else if (late < early) float = -workdayOffset(late, early, calendar);
    return { id: node.id, float, critical: float <= 0 };
  });
  return { finish, items };
}
