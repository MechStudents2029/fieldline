import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { invoicesCsv } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  if (!canSeeMoney(session.role)) return new NextResponse("Invoices are hidden for this role.", { status: 403 });
  return new NextResponse(invoicesCsv(session.orgId), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-qbo-invoices.csv",
    },
  });
}
