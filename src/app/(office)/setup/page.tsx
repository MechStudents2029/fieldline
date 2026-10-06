import { SetupScreen } from "@/components/setup-checklist";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { companyChecklist } from "@/lib/services/onboarding";

export default async function SetupPage() {
  const session = await requireSession();
  const checklist = companyChecklist(session.orgId);
  if (!checklist) return null;
  return <SetupScreen steps={checklist.steps} canDismiss={canManageSettings(session.role)} />;
}
