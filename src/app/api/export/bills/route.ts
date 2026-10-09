import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { billsCsv } from "@/lib/services/waivers";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const csv = billsCsv(session);
  if (!csv) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-bills.csv",
    },
  });
}
