"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { archiveReport, duplicateReport, parseQuery, saveReport, updateReport } from "@/lib/services/reports";
import { addTile, assignDashboard, createDashboard, orderTiles } from "@/lib/services/dashboards";

function filters(formData: FormData) {
  return [0, 1, 2]
    .map((index) => ({
      column: String(formData.get(`f${index}`) || ""),
      op: String(formData.get(`op${index}`) || "eq") as "eq" | "contains" | "gt" | "lt" | "in",
      value: String(formData.get(`v${index}`) || ""),
    }))
    .filter((filter) => filter.column && filter.value);
}

function queryFrom(formData: FormData) {
  const columns = String(formData.get("columns") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const chart = String(formData.get("chart") || "");
  return parseQuery({
    columns,
    filters: filters(formData),
    dateColumn: String(formData.get("date") || ""),
    from: String(formData.get("from") || ""),
    to: String(formData.get("to") || ""),
    sort: String(formData.get("sort") || ""),
    dir: String(formData.get("dir") || "asc") === "desc" ? "desc" : "asc",
    groupBy: String(formData.get("group") || ""),
    chart: chart === "bar" || chart === "line" ? chart : "",
    chartColumn: String(formData.get("chartColumn") || ""),
  });
}

export async function saveReportAction(formData: FormData) {
  const session = await requireSession();
  try {
    const reportId = saveReport(session, {
      name: String(formData.get("name") || ""),
      source: String(formData.get("source") || ""),
      share: String(formData.get("share") || "private"),
      query: queryFrom(formData),
    });
    revalidatePath("/reports");
    redirect(`/reports/saved/${reportId}`);
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/reports/new?source=${formData.get("source")}&error=1`);
    throw error;
  }
}

export async function renameReportAction(formData: FormData) {
  const session = await requireSession();
  const reportId = String(formData.get("id") || "");
  updateReport(session, reportId, { name: String(formData.get("name") || ""), share: String(formData.get("share") || "") });
  revalidatePath(`/reports/saved/${reportId}`);
}

export async function duplicateReportAction(formData: FormData) {
  const session = await requireSession();
  const reportId = duplicateReport(session, String(formData.get("id") || ""));
  revalidatePath("/reports");
  redirect(`/reports/saved/${reportId}`);
}

export async function archiveReportAction(formData: FormData) {
  const session = await requireSession();
  archiveReport(session, String(formData.get("id") || ""));
  revalidatePath("/reports");
  redirect("/reports");
}

export async function createDashboardAction(formData: FormData) {
  const session = await requireSession();
  const boardId = createDashboard(session, String(formData.get("name") || ""));
  revalidatePath("/reports/dashboards");
  redirect(`/reports/dashboards?board=${boardId}`);
}

export async function addTileAction(formData: FormData) {
  const session = await requireSession();
  const boardId = String(formData.get("dashboardId") || "");
  addTile(session, boardId, {
    title: String(formData.get("title") || ""),
    kind: String(formData.get("kind") || "number"),
    reportKey: String(formData.get("reportKey") || ""),
    metric: String(formData.get("metric") || "count"),
    metricColumn: String(formData.get("metricColumn") || ""),
  });
  revalidatePath("/reports/dashboards");
  redirect(`/reports/dashboards?board=${boardId}`);
}

export async function orderTilesAction(formData: FormData) {
  const session = await requireSession();
  const boardId = String(formData.get("dashboardId") || "");
  orderTiles(session, boardId, formData.getAll("ids").map(String));
  revalidatePath("/");
  revalidatePath("/reports/dashboards");
}

export async function assignDashboardAction(formData: FormData) {
  const session = await requireSession();
  assignDashboard(session, String(formData.get("dashboardId") || ""), String(formData.get("role") || ""));
  revalidatePath("/");
  revalidatePath("/reports/dashboards");
}
