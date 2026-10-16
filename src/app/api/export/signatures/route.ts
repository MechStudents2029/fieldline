import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { signatureCsv } from "@/lib/services/doc-signatures";
import { ServiceError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in required", { status: 401 });
  const url = new URL(request.url);
  try {
    const csv = signatureCsv(session, {
      status: url.searchParams.get("status") || "",
      projectId: url.searchParams.get("project") || "",
      signerRole: url.searchParams.get("signer") || "",
      overdue: url.searchParams.get("overdue") === "1",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=fieldline-signatures.csv",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
