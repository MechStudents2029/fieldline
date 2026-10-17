import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { observationsCsv } from "@/lib/services/observations";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  try {
    const csv = observationsCsv(session, {
      type: url.searchParams.get("type") ?? "",
      status: url.searchParams.get("filter") ?? "",
      priority: url.searchParams.get("priority") ?? "",
      vendorContactId: url.searchParams.get("vendor") ?? "",
      projectId: url.searchParams.get("project") ?? "",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-observations.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
