import { ImportWizard } from "@/components/mac/import-wizard";
import { Segmented, Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { isImportKind, type ImportKind } from "@/lib/import/map";
import { canManageSettings } from "@/lib/permissions";
import { listImports } from "@/lib/services/import";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const kind: ImportKind = query.kind && isImportKind(query.kind) ? query.kind : "contacts";
  if (!canManageSettings(session.role)) {
    return (
      <div>
        <div className="hidden md:block">
          <Toolbar title="Import" search={false} />
        </div>
        <h1 className="fl-large-title md:hidden">Import</h1>
      </div>
    );
  }
  const history = listImports(session);
  const kinds = [
    { href: "/import?kind=contacts", label: "Contacts", current: kind === "contacts" },
    { href: "/import?kind=vendors", label: "Vendors", current: kind === "vendors" },
    { href: "/import?kind=price_book", label: "Price book", current: kind === "price_book" },
  ];
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 md:max-w-none md:h-full md:gap-0">
      <div className="hidden md:block">
        <Toolbar title="Import" search={false} center={<Segmented items={kinds} />} />
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        <h1 className="fl-large-title">Import</h1>
        <Segmented items={kinds} />
      </div>
      <ImportWizard key={kind} kind={kind} history={history} />
    </div>
  );
}
