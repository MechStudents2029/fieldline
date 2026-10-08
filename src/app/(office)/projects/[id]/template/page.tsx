import Link from "next/link";
import { importTemplateAction, saveJobAsTemplateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm } from "@/lib/permissions";
import { jobPartCounts, previewTemplateImport, templateChoices } from "@/lib/services/templates";
import type { TemplatePart } from "@/lib/services/templates";
import { calendarForOrg } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

const PARTS: { key: TemplatePart; label: string }[] = [
  { key: "schedule", label: "Schedule" },
  { key: "estimate", label: "Estimate" },
  { key: "draws", label: "Draws" },
  { key: "selections", label: "Selections" },
  { key: "punch", label: "Punch" },
  { key: "todos", label: "To-dos" },
];

function todayFor(orgId: string) {
  return localDay(Date.now(), calendarForOrg(orgId).timeZone);
}

export default async function JobTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";
  const many = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value : value ? value.split(",") : []).flatMap((part) => part.split(",")).filter(Boolean);
  const session = await requireSession();
  if (!canEditCrm(session.role)) {
    return (
      <div className="px-4 py-6">
        <p>Your role cannot change templates.</p>
      </div>
    );
  }
  const counts = jobPartCounts(session, id);
  if (!counts) {
    return (
      <div className="px-4 py-6">
        <p>That job is not in your company.</p>
      </div>
    );
  }
  const choices = templateChoices(session);
  const today = todayFor(session.orgId);
  const templateId = one(query.template);
  const anchor = one(query.anchor);
  const requested = many(query.parts);
  const selected = (requested.length ? requested : PARTS.map((part) => part.key)).filter((part): part is TemplatePart => PARTS.some((row) => row.key === part));
  let preview: ReturnType<typeof previewTemplateImport> | null = null;
  if (templateId) {
    try {
      preview = previewTemplateImport(session, id, templateId, selected);
    } catch {
      preview = null;
    }
  }
  const template = choices.templates.find((row) => row.id === templateId) ?? choices.templates[0];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <Link href={`/projects/${id}`} className="text-sm text-[var(--fl-accent)]">
        ‹ Job
      </Link>
      <section className="flex flex-col gap-3">
        <h1 className="fl-title">Save as template</h1>
        <ActionForm action={saveJobAsTemplateAction} className="flex flex-col gap-2">
          <input type="hidden" name="projectId" value={id} />
          <label className="text-sm">
            Name
            <input name="name" aria-label="Name" required className="field mt-1" />
          </label>
          <label className="text-sm">
            Type
            <input name="jobType" aria-label="Type" required className="field mt-1" />
          </label>
          {PARTS.map((part) => {
            const count = counts[part.key];
            if (count == null) return null;
            return (
              <label key={part.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="part" value={part.key} defaultChecked={count > 0} />
                <span className="flex-1">{part.label}</span>
                <span className="num">{count}</span>
              </label>
            );
          })}
          <button type="submit" className="mac-primary w-fit">
            Save
          </button>
        </ActionForm>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="fl-section">Import</h2>
        <form className="flex flex-col gap-2" method="get">
          <label className="text-sm">
            Template
            <select name="template" aria-label="Template" defaultValue={templateId || template?.id} className="field mt-1">
              {choices.templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Anchor
            <input name="anchor" type="date" aria-label="Anchor" defaultValue={anchor || today} className="field mt-1" />
          </label>
          {PARTS.map((part) => (
            <label key={part.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="parts" value={part.key} defaultChecked={selected.includes(part.key)} />
              {part.label}
            </label>
          ))}
          <button type="submit" className="w-fit text-sm">
            Preview
          </button>
        </form>
        {preview ? (
          <div className="flex flex-col gap-2">
            <table className="mac-table" aria-label="Import preview">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Schedule", preview.schedule],
                    ["Estimate", preview.estimate],
                    ["Draws", preview.draws],
                    ["Selections", preview.selections],
                    ["Punch", preview.punch],
                    ["To-dos", preview.todos],
                  ] as const
                ).map(([label, row]) =>
                  row.before == null ? null : (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num">{row.before}</td>
                      <td className="num">{row.after}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <ActionForm action={importTemplateAction} className="flex flex-col gap-2">
              <input type="hidden" name="projectId" value={id} />
              <input type="hidden" name="templateId" value={templateId} />
              <input type="hidden" name="anchor" value={anchor || today} />
              {selected.map((part) => (
                <input key={part} type="hidden" name="part" value={part} />
              ))}
              {(template?.trades ?? []).map((trade) => (
                <label key={trade} className="text-sm">
                  {trade}
                  <select name={`trade:${trade}`} aria-label={trade} className="field mt-1" defaultValue="">
                    <option value="">Unassigned</option>
                    {choices.vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button type="submit" className="mac-primary w-fit">
                Add {preview.added} items
              </button>
            </ActionForm>
          </div>
        ) : null}
      </section>
    </div>
  );
}
