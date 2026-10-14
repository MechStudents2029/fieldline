import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { clientCreditCsv } from "@/lib/services/client-credits";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const query = new URL(request.url).searchParams;
  const csv = clientCreditCsv(session, {
    status: query.get("status") || undefined,
    projectId: query.get("job") || undefined,
    clientContactId: query.get("client") || undefined,
    attention: query.get("attention") === "1",
  });
  if (!csv) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-credit-memos.csv",
    },
  });
}
