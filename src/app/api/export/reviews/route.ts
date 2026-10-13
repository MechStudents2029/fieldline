import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { reviewCsv } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const status = new URL(request.url).searchParams.get("status") || "";
  const csv = reviewCsv(session, status);
  if (!csv) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-reviews.csv",
    },
  });
}
