import { Shell } from "@/components/shell";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <Shell orgName={session.orgName} userName={session.name} role={session.role} orgId={session.orgId} userId={session.userId}>
      {children}
    </Shell>
  );
}
