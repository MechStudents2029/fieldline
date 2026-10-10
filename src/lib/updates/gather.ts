import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { changeOrders, dailyLogPhotos, dailyLogs, documents, invoices, payments, scheduleItems, selections } from "@/lib/db/schema";
import { localDay } from "@/lib/time/calendar";
import type { ClientUpdateFacts } from "@/lib/updates/draft";

function invoiceFacts(
  invoiceRows: { id: string; number: string; status: string; totalCents: number; issueDate: string }[],
  paidAt: Map<string, string[]>,
  range: DayRange,
  timeZone: string,
): ClientUpdateFacts["invoices"] {
  const rows: ClientUpdateFacts["invoices"] = [];
  for (const invoice of invoiceRows) {
    const issued = invoice.issueDate.slice(0, 10);
    const paidInRange = (paidAt.get(invoice.id) ?? []).some((iso) => {
      const day = localOf(iso, timeZone);
      return day != null && inRange(day, range.start, range.end);
    });
    if (invoice.status === "paid" && (paidInRange || inRange(issued, range.start, range.end))) {
      rows.push({ id: invoice.id, number: invoice.number, status: "paid", totalCents: invoice.totalCents });
    } else if (invoice.status === "open" && inRange(issued, range.start, range.end)) {
      rows.push({ id: invoice.id, number: invoice.number, status: "sent", totalCents: invoice.totalCents });
    }
  }
  return rows;
}
import { inRange, nextWeekRange, type DayRange } from "@/lib/updates/range";

function captionOf(metadataJson: string | null): string {
  if (!metadataJson) return "";
  try {
    const parsed = JSON.parse(metadataJson) as { caption?: unknown };
    return typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  } catch {
    return "";
  }
}

function localOf(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return null;
  return localDay(instant, timeZone);
}

/**
 * Client-safe facts for one job and one local date range.
 * Delays, safety, crew, hours, costs, bills, and purchase orders are not loaded.
 */
export function gatherClientUpdateFacts(db: AppDatabase, orgId: string, projectId: string, range: DayRange, timeZone: string): ClientUpdateFacts {
  const logs = db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
      notes: dailyLogs.notes,
      plannedNext: dailyLogs.plannedNext,
      weatherSky: dailyLogs.weatherSky,
      weatherHighF: dailyLogs.weatherHighF,
      weatherLowF: dailyLogs.weatherLowF,
    })
    .from(dailyLogs)
    .where(and(eq(dailyLogs.orgId, orgId), eq(dailyLogs.projectId, projectId), eq(dailyLogs.status, "published"), eq(dailyLogs.visibility, "client")))
    .all()
    .filter((log) => inRange(log.logDate, range.start, range.end))
    .sort((a, b) => a.logDate.localeCompare(b.logDate) || a.id.localeCompare(b.id));

  const logIds = logs.map((log) => log.id);
  const photoRows = logIds.length
    ? db
        .select({
          logId: dailyLogPhotos.logId,
          documentId: dailyLogPhotos.documentId,
          createdAt: dailyLogPhotos.createdAt,
        })
        .from(dailyLogPhotos)
        .where(and(eq(dailyLogPhotos.orgId, orgId), inArray(dailyLogPhotos.logId, logIds)))
        .all()
    : [];
  const documentIds = [...new Set(photoRows.map((row) => row.documentId))];
  const docs = documentIds.length
    ? db
        .select({ id: documents.id, metadataJson: documents.metadataJson, deletedAt: documents.deletedAt })
        .from(documents)
        .where(and(eq(documents.orgId, orgId), inArray(documents.id, documentIds)))
        .all()
    : [];
  const captions = new Map(docs.filter((doc) => !doc.deletedAt).map((doc) => [doc.id, captionOf(doc.metadataJson)]));
  const photosByLog = new Map<string, { id: string; caption: string; createdAt: string }[]>();
  for (const row of photoRows) {
    if (!captions.has(row.documentId)) continue;
    const list = photosByLog.get(row.logId) ?? [];
    list.push({ id: row.documentId, caption: captions.get(row.documentId) || "", createdAt: row.createdAt });
    photosByLog.set(row.logId, list);
  }

  const next = nextWeekRange(range.end);
  const schedule = db
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      startDate: scheduleItems.startDate,
      endDate: scheduleItems.endDate,
      status: scheduleItems.status,
    })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId)))
    .all();

  const orders = db
    .select({
      id: changeOrders.id,
      number: changeOrders.number,
      title: changeOrders.title,
      status: changeOrders.status,
      priceDeltaCents: changeOrders.priceDeltaCents,
      sentAt: changeOrders.sentAt,
      approvedAt: changeOrders.approvedAt,
    })
    .from(changeOrders)
    .where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.projectId, projectId)))
    .all();

  const invoiceRows = db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      totalCents: invoices.totalCents,
      issueDate: invoices.issueDate,
    })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.projectId, projectId)))
    .all();
  const invoiceIds = invoiceRows.map((row) => row.id);
  const paidAt = new Map<string, string[]>();
  if (invoiceIds.length > 0) {
    const paid = db
      .select({ invoiceId: payments.invoiceId, status: payments.status, createdAt: payments.createdAt })
      .from(payments)
      .where(inArray(payments.invoiceId, invoiceIds))
      .all();
    for (const payment of paid) {
      if (payment.status !== "succeeded") continue;
      const list = paidAt.get(payment.invoiceId) ?? [];
      list.push(payment.createdAt);
      paidAt.set(payment.invoiceId, list);
    }
  }

  const picks = db
    .select({ id: selections.id, title: selections.title, dueDate: selections.dueDate, status: selections.status })
    .from(selections)
    .where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId), eq(selections.status, "released")))
    .all();

  return {
    logs: logs.map((log) => ({
      id: log.id,
      logDate: log.logDate,
      notes: log.notes,
      plannedNext: log.plannedNext,
      weatherSky: log.weatherSky,
      weatherHighF: log.weatherHighF,
      weatherLowF: log.weatherLowF,
      photos: (photosByLog.get(log.id) ?? [])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((photo) => ({ id: photo.id, caption: photo.caption })),
    })),
    completed: schedule
      .filter((item) => item.status === "done" && inRange(item.endDate, range.start, range.end))
      .map((item) => ({ id: item.id, title: item.title, endDate: item.endDate })),
    started: schedule
      .filter((item) => item.status !== "done" && inRange(item.startDate, range.start, range.end))
      .map((item) => ({ id: item.id, title: item.title, startDate: item.startDate })),
    upcoming: schedule
      .filter((item) => item.status !== "done" && inRange(item.startDate, next.start, next.end))
      .map((item) => ({ id: item.id, title: item.title, startDate: item.startDate })),
    changeOrders: orders.flatMap((order) => {
      if (order.status !== "approved" && order.status !== "sent") return [];
      const when = localOf(order.status === "approved" ? order.approvedAt || order.sentAt : order.sentAt, timeZone);
      if (!when || !inRange(when, range.start, range.end)) return [];
      return [{ id: order.id, number: order.number, title: order.title, status: order.status, priceDeltaCents: order.priceDeltaCents }];
    }),
    invoices: invoiceFacts(invoiceRows, paidAt, range, timeZone),
    selections: picks.flatMap((pick) => {
      if (!pick.dueDate || !inRange(pick.dueDate, range.start, range.end)) return [];
      return [{ id: pick.id, title: pick.title, dueDate: pick.dueDate }];
    }),
  };
}
