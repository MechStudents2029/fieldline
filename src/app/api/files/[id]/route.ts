import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { dataDir, getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { documents, projects } from "@/lib/db/schema";
import { demoAssetPath, fileResponseHeaders, fileVisible, resolveInside } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await context.params;
  const portal = new URL(request.url).searchParams.get("portal");
  const db = portal ? getDb() : session ? officeDb(session.orgId) : null;
  if (!db) return new Response("Not found", { status: 404 });
  const document = db
    .select()
    .from(documents)
    .where(portal ? eq(documents.id, id) : and(eq(documents.id, id), eq(documents.orgId, session!.orgId)))
    .get();
  if (!document || document.deletedAt) return new Response("Not found", { status: 404 });
  const portalMatch = Boolean(
    portal &&
      document.projectId &&
      db
        .select()
        .from(projects)
        .where(and(eq(projects.id, document.projectId), eq(projects.orgId, document.orgId), eq(projects.portalToken, portal)))
        .get(),
  );
  if (!fileVisible({ sessionOrgId: session?.orgId ?? null, documentOrgId: document.orgId, portalMatch })) {
    return new Response("Not found", { status: 404 });
  }
  const demo = demoAssetPath(document.storagePath);
  if (demo) return Response.redirect(new URL(demo, request.url));
  const file = resolveInside(dataDir(), document.storagePath);
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const body = fs.readFileSync(file);
  return new Response(body, { headers: fileResponseHeaders(document.filename, body) });
}
