import { fileResponseHeaders } from "@/lib/security";
import { transmittalFileByToken } from "@/lib/services/transmittals";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string; lineId: string }> }) {
  const { token, lineId } = await context.params;
  const file = transmittalFileByToken(token, lineId);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: fileResponseHeaders(file.filename, file.bytes) });
}
