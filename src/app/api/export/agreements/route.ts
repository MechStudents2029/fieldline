import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { agreementsCsv } from "@/lib/services/agreements";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  try {
    const csv = agreementsCsv(session, url.searchParams.get("status") || "");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-agreements.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse(error.message, { status: 400 });
    throw error;
  }
}
