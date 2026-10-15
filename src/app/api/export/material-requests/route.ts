import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { materialCsv } from "@/lib/services/material-requests";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const csv = materialCsv(session);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-material-requests.csv",
    },
  });
}
