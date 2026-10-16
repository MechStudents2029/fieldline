import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { specCsv } from "@/lib/services/job-specs";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  try {
    const csv = specCsv(session);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-specs.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
