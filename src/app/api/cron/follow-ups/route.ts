import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { scanFollowUps } from "@/lib/services/write";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  }
  const orgs = getDb().select().from(organizations).all();
  const created = orgs.reduce((sum, org) => sum + scanFollowUps(org.id).created, 0);
  return NextResponse.json({ ok: true, created, demo: !secret });
}
