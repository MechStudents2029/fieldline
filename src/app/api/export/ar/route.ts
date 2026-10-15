import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { arAgingCsv } from "@/lib/services/late-fees";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  try {
    const csv = arAgingCsv(session);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-ar.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
