import { PrintButton } from "@/components/print-button";
import type { PublicSpec } from "@/lib/services/job-specs";

export function SpecPublic({ pack }: { pack: Extract<PublicSpec, { state: "published" }> }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-10" data-status="published" data-version={pack.version}>
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{pack.orgName}</h1>
      <p className="mt-2 text-sm">{pack.title}</p>
      <p className="num text-sm">v{pack.version}</p>
      <div className="mt-3 flex items-center gap-3 print:hidden">
        <a href={`/spec/${pack.token}/print`} className="text-sm text-[var(--mac-accent)]">
          Print
        </a>
        <PrintButton />
      </div>
      <div className="mt-6 flex flex-col gap-6">
        {pack.groups.map((group) => (
          <section key={group.label}>
            <h2 className="text-sm text-[var(--mac-secondary)]">{group.label}</h2>
            <ul className="mt-2 flex flex-col gap-3">
              {group.lines.map((line) => (
                <li key={`${group.label}-${line.description}-${line.notes}`}>
                  <p className="text-sm">
                    {line.costCode ? <span className="num mr-2">{line.costCode}</span> : null}
                    {line.description}
                  </p>
                  {line.notes ? <p className="text-sm text-[var(--mac-secondary)]">{line.notes}</p> : null}
                  {line.files.map((file) => (
                    <a key={file.id} href={`/spec/${pack.token}/file/${file.id}`} className="text-sm text-[var(--mac-accent)]">
                      {file.filename}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
