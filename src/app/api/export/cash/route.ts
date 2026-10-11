import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canSeeCash } from "@/lib/permissions";
import { cashCsv } from "@/lib/services/cash";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (!canSeeCash(session.role)) return new NextResponse("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const csv = cashCsv(session, {
    projected: url.searchParams.get("projected") === "1",
    jobId: url.searchParams.get("job") ?? "",
    customerId: url.searchParams.get("customer") ?? "",
  });
  return new NextResponse(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
