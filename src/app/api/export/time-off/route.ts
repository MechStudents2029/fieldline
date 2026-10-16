import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { timeOffCsv } from "@/lib/services/time-off";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  try {
    const csv = timeOffCsv(session, {
      userId: url.searchParams.get("user") ?? "",
      status: url.searchParams.get("status") ?? "",
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-time-off.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
