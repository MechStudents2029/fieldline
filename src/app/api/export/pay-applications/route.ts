import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { payApplicationsCsv } from "@/lib/services/pay-applications";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  try {
    const csv = payApplicationsCsv(session, {
      projectId: url.searchParams.get("project") ?? "",
      vendorContactId: url.searchParams.get("vendor") ?? "",
      status: url.searchParams.get("filter") ?? "",
      period: url.searchParams.get("period") ?? "",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-pay-applications.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
