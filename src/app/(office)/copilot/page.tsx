import { CopilotPanel } from "@/components/copilot-panel";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { askCopilot } from "@/lib/services/read";

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <p>Copilot reads receivables and margins, so it is hidden for the field role.</p>;
  }
  const question = (await searchParams).q?.trim() ?? "";
  const result = question ? askCopilot(session.orgId, question) : null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">Ask the business</h1>
        <p className="text-sm text-muted-foreground">Read-only. It calls typed tools, not free-form SQL, and it does not change money.</p>
      </div>
      <CopilotPanel question={question} result={result} />
    </div>
  );
}
