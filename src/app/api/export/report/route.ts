import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { openBuiltin, openSaved, parseQuery, reportCsv } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  try {
    const extra = url.searchParams.get("col")
      ? parseQuery({ filters: [{ column: url.searchParams.get("col") || "", op: (url.searchParams.get("op") || "eq") as "eq", value: url.searchParams.get("val") || "" }] }).filters
      : [];
    const view = url.searchParams.get("saved") === "1" ? openSaved(session, id) : openBuiltin(session, id, extra);
    return new NextResponse(reportCsv(view), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${view.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
