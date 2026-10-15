import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { currentNecYear, necCsv } from "@/lib/services/nec1099";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const raw = new URL(request.url).searchParams.get("year") || "";
  const year = raw ? Number(raw) : currentNecYear(session.orgId);
  try {
    const csv = necCsv(session, year);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=fieldline-1099-${year}.csv`,
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
