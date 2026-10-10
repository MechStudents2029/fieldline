import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { scheduleVarianceCsv } from "@/lib/services/schedule-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (!canEditCrm(session.role)) return new NextResponse("Forbidden", { status: 403 });
  const all = new URL(request.url).searchParams.get("all") === "1";
  const csv = scheduleVarianceCsv(session, !all);
  return new NextResponse(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
