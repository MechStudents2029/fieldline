import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { wipCsv, wipQuery } from "@/lib/services/wip";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (!canEditCrm(session.role)) return new NextResponse("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const csv = wipCsv(
    session,
    wipQuery({
      asof: url.searchParams.get("asof"),
      pm: url.searchParams.get("pm"),
      status: url.searchParams.get("status"),
      sort: url.searchParams.get("sort"),
      dir: url.searchParams.get("dir"),
    }),
  );
  return new NextResponse(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
