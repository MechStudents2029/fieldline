import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { stockCsv } from "@/lib/services/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  const csv = stockCsv(session, {
    locationId: url.searchParams.get("location") || "",
    low: url.searchParams.get("low") === "1",
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-inventory.csv",
    },
  });
}
