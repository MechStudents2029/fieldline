import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deliveriesCsv } from "@/lib/services/receiving";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (session.role === "viewer") return new NextResponse("Deliveries are for the office and the field.", { status: 403 });
  const status = new URL(request.url).searchParams.get("status") || "";
  const bucket = status === "expected" || status === "late" || status === "received" || status === "today" ? status : "";
  const csv = deliveriesCsv(session, bucket);
  return new NextResponse(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
