import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncResponse } from "@/lib/services/sync";

export async function POST(request: Request) {
  const session = await getSession();
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = syncResponse(session, body);
  return NextResponse.json(result.body, { status: result.status });
}
