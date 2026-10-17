import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { budgetChangesCsv } from "@/lib/services/budget-changes";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  try {
    const csv = budgetChangesCsv(session, {
      filter: url.searchParams.get("filter") ?? "",
      projectId: url.searchParams.get("project") ?? "",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-budget-changes.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
