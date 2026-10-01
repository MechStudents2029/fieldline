import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { invoicesCsv } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  return new NextResponse(invoicesCsv(session.orgId), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-invoices.csv",
    },
  });
}
