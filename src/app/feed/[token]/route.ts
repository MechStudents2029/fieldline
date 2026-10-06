import { scheduleFeedIcs } from "@/lib/services/schedule";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = scheduleFeedIcs(token);
  if (!body) return new Response("Not found.", { status: 404 });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": "inline; filename=\"fieldline.ics\"",
      "cache-control": "private, no-store",
    },
  });
}
