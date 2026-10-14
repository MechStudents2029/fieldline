import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { commissionCsv } from "@/lib/services/commissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  const csv = commissionCsv(session, {
    status: url.searchParams.get("status") || "",
    userId: url.searchParams.get("user") || "",
    projectId: url.searchParams.get("job") || "",
  });
  if (!csv) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-commissions.csv",
    },
  });
}
