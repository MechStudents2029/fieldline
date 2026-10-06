import { csvTemplate, isImportKind, templateName } from "@/lib/import/map";
import { getSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session || !canManageSettings(session.role)) return new Response("Import is for owners and admins.", { status: 403 });
  const { kind } = await context.params;
  if (!isImportKind(kind)) return new Response("Not found.", { status: 404 });
  return new Response(csvTemplate(kind), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${templateName(kind)}"`,
      "cache-control": "private, no-store",
    },
  });
}
