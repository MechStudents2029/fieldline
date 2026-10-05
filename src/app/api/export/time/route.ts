import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { approvedHoursCsv } from "@/lib/services/time";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (!canManageSettings(session.role)) return new NextResponse("Payroll hours are limited to an owner or admin.", { status: 403 });
  const url = new URL(request.url);
  try {
    const csv = approvedHoursCsv(session, url.searchParams.get("from") || "", url.searchParams.get("to") || "");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-time.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse(error.message, { status: 400 });
    throw error;
  }
}
