import { resetDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Wipes the throwaway e2e database. Absent unless FIELDLINE_E2E=1. */
export async function POST() {
  if (process.env.FIELDLINE_E2E !== "1") return new Response("Not found", { status: 404 });
  resetDatabase();
  return Response.json({ ok: true });
}
