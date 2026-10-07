import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { rfiCsv } from "@/lib/services/rfis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const project = new URL(request.url).searchParams.get("project");
  const csv = rfiCsv(session, project);
  const filename = project ? `fieldline-rfis-${project}.csv` : "fieldline-rfis.csv";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}
