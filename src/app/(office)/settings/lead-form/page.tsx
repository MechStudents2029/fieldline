import { LeadFormSettings } from "@/components/lead-form-settings";
import { requireSession } from "@/lib/auth/session";
import { embedSnippet } from "@/lib/lead-form/rules";
import { appOrigin } from "@/lib/security";
import { leadFormBoard } from "@/lib/services/lead-form";

export default async function LeadFormSettingsPage() {
  const session = await requireSession();
  const board = leadFormBoard(session);
  if (!board) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-6">
        <h1 className="font-heading text-3xl">Lead form</h1>
        <p className="text-sm">Only an owner or admin can change the lead form.</p>
      </div>
    );
  }
  const origin = appOrigin(process.env) ?? "";
  const url = `${origin}/f/${board.token}`;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 pb-10">
      <div>
        <h1 className="font-heading text-3xl">Lead form</h1>
        <p className="text-sm text-muted-foreground">{session.orgName}</p>
      </div>
      <LeadFormSettings board={board} url={url} embed={embedSnippet(url)} />
    </div>
  );
}
