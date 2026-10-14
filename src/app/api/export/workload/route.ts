import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { workloadCsv } from "@/lib/services/workload";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  const csv = workloadCsv(session, {
    on: url.searchParams.get("on") || undefined,
    role: url.searchParams.get("role") || "",
    crew: url.searchParams.get("crew") || "",
    vendors: url.searchParams.get("vendors") === "1",
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=fieldline-workload.csv",
    },
  });
}
