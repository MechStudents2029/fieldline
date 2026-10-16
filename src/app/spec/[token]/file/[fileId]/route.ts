import { fileResponseHeaders } from "@/lib/security";
import { specFileByToken } from "@/lib/services/job-specs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await context.params;
  const file = specFileByToken(token, fileId);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: fileResponseHeaders(file.filename, file.bytes) });
}
