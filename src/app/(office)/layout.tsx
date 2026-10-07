import { Shell } from "@/components/shell";
import { requireSession } from "@/lib/auth/session";
import { inboxUnread } from "@/lib/services/comments";
import { officeChrome } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const chrome = officeChrome(session.orgId);
  const unread = inboxUnread(session);
  return (
    <Shell orgName={session.orgName} userName={session.name} role={session.role} orgId={session.orgId} userId={session.userId} chrome={chrome} inboxUnread={unread}>
      {children}
    </Shell>
  );
}
