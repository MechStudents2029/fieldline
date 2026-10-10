import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { safetyCsv } from "@/lib/services/safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  const csv = safetyCsv(session, {
    type: url.searchParams.get("type") || "",
    status: url.searchParams.get("status") || "",
    job: url.searchParams.get("job") || "",
  });
  return new NextResponse(csv.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csv.filename}"`,
    },
  });
}
