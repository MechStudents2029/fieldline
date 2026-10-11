import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ticketsCsv } from "@/lib/services/tm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const params = new URL(request.url).searchParams;
  const csv = ticketsCsv(session, { status: params.get("status") || "", projectId: params.get("job") || "" });
  return new NextResponse(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
