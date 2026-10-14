import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { cronAuthorized } from "@/lib/security";
import { rollAgreements } from "@/lib/services/agreements";
import { scanAutomationClock } from "@/lib/services/automations";
import { scanCollections } from "@/lib/services/collections";
import { scanSelectionFollowUps } from "@/lib/services/selection-followups";
import { scanFollowUps } from "@/lib/services/write";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const allowed = cronAuthorized(request.headers.get("authorization"), process.env);
  if (!allowed.ok) return NextResponse.json({ ok: false }, { status: 401 });
  const orgs = getDb().select().from(organizations).all();
  const created = orgs.reduce((sum, org) => sum + scanFollowUps(org.id).created, 0);
  const automations = orgs.reduce((sum, org) => sum + scanAutomationClock(org.id).ran, 0);
  const agreements = orgs.reduce((sum, org) => sum + rollAgreements(org.id).invoices, 0);
  const collections = orgs.reduce((sum, org) => sum + scanCollections(org.id).created, 0);
  const selectionFollowUps = orgs.reduce((sum, org) => sum + scanSelectionFollowUps(org.id).created, 0);
  return NextResponse.json({ ok: true, created, automations, agreements, collections, selectionFollowUps, demo: allowed.demo });
}
