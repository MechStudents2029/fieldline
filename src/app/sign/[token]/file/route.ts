import { fileResponseHeaders } from "@/lib/security";
import { signatureFileByToken } from "@/lib/services/doc-signatures";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const file = signatureFileByToken(token);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: fileResponseHeaders(file.filename, file.bytes) });
}
