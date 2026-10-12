import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { vendorCreditCsv } from "@/lib/services/vendor-credits";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const csv = vendorCreditCsv(session);
  if (!csv) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-vendor-credits.csv",
    },
  });
}
