import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { documents, projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await context.params;
  const portal = new URL(request.url).searchParams.get("portal");
  const db = getDb();
  const document = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!document) return new Response("Not found", { status: 404 });
  const portalMatch =
    portal && document.projectId
      ? db
          .select()
          .from(projects)
          .where(and(eq(projects.id, document.projectId), eq(projects.portalToken, portal)))
          .get()
      : null;
  if (!(session && session.orgId === document.orgId) && !portalMatch) {
    return new Response("Sign in required", { status: 401 });
  }
  if (document.storagePath.startsWith("/demo/")) {
    return Response.redirect(new URL(document.storagePath, request.url));
  }
  const root = path.resolve(process.cwd(), "data") + path.sep;
  const file = path.resolve(process.cwd(), "data", document.storagePath);
  if (!file.startsWith(root) || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const body = fs.readFileSync(file);
  const type = document.filename.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
  return new Response(body, { headers: { "Content-Type": type } });
}
