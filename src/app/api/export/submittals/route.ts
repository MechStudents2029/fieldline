import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { submittalCsv } from "@/lib/services/submittals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const project = new URL(request.url).searchParams.get("project");
  const csv = submittalCsv(session, project);
  const filename = project ? `fieldline-submittals-${project}.csv` : "fieldline-submittals.csv";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}
