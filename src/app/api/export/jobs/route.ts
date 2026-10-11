import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listCsv, matchesCustom } from "@/lib/services/custom-fields";
import { listProjects } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const rows = listProjects(session.orgId).filter((row) => matchesCustom(session, "job", row.project.id, query));
  const body = listCsv(
    session,
    "job",
    rows.map((row) => ({ id: row.project.id, cells: [row.project.name, row.project.status] })),
    ["Job", "Status"],
  );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=jobs.csv",
    },
  });
}
