import { Shell } from "@/components/shell";
import { requireSession } from "@/lib/auth/session";
import { officeChrome } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const chrome = officeChrome(session.orgId);
  return (
    <Shell orgName={session.orgName} userName={session.name} role={session.role} orgId={session.orgId} userId={session.userId} chrome={chrome}>
      {children}
    </Shell>
  );
}
