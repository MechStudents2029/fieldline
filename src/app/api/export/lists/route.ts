import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listCsv, matchesCustom } from "@/lib/services/custom-fields";
import { listContacts, listPriceBook, pipelineBoard } from "@/lib/services/read";
import { listTodos } from "@/lib/services/todos";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  const list = url.searchParams.get("list") || "";
  const query = Object.fromEntries(url.searchParams.entries());
  let body = "";
  let filename = "list.csv";
  if (list === "contacts") {
    const rows = listContacts(session.orgId, query.q, query.type).filter((row) => matchesCustom(session, row.type === "client" ? "client" : "vendor", row.id, query));
    const clients = rows.filter((row) => row.type === "client");
    const vendors = rows.filter((row) => row.type !== "client");
    body = [
      listCsv(session, "client", clients.map((row) => ({ id: row.id, cells: [row.name, row.type] })), ["Name", "Type"]).trimEnd(),
      listCsv(session, "vendor", vendors.map((row) => ({ id: row.id, cells: [row.name, row.type] })), ["Name", "Type"]).trimEnd(),
    ].filter((part) => part.split("\n").length > 1).join("\n");
    filename = "contacts.csv";
  } else if (list === "leads") {
    const cards = pipelineBoard(session.orgId, { q: query.q, source: query.source }).cards.filter((card) => matchesCustom(session, "lead", card.lead.id, query));
    body = listCsv(session, "lead", cards.map((card) => ({ id: card.lead.id, cells: [card.lead.title, card.contact.name] })), ["Lead", "Client"]);
    filename = "leads.csv";
  } else if (list === "price") {
    const rows = listPriceBook(session.orgId, query.q).filter((row) => matchesCustom(session, "price_item", row.id, query));
    body = listCsv(session, "price_item", rows.map((row) => ({ id: row.id, cells: [row.code, row.name] })), ["Code", "Name"]);
    filename = "price-book.csv";
  } else if (list === "todos") {
    const rows = listTodos(session, { status: "all" }).filter((row) => matchesCustom(session, "todo", row.id, query));
    body = listCsv(session, "todo", rows.map((row) => ({ id: row.id, cells: [row.title, row.projectName] })), ["Title", "Job"]);
    filename = "todos.csv";
  } else return new NextResponse("Unknown list", { status: 404 });
  return new NextResponse(body.endsWith("\n") ? body : `${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}
