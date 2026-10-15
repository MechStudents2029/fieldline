import Link from "next/link";
import { saveCredentialTypesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageMoney } from "@/lib/permissions";
import { credentialTypesFor } from "@/lib/services/certifications";

export default async function CredentialTypesPage() {
  const session = await requireSession();
  const types = credentialTypesFor(session);
  const office = canManageMoney(session.role);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Credential types" subtitle={String(types.length)} search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
        <h1 className="fl-large-title md:hidden">Credential types</h1>
        {office ? (
          <ActionForm action={saveCredentialTypesAction} className="flex flex-col gap-3">
            {types.map((type) => (
              <div key={type.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2" data-type={type.id}>
                <input type="hidden" name="typeId" value={type.id} />
                <input name="name" aria-label={`Name ${type.name}`} className="field" defaultValue={type.name} />
                <select name="required" aria-label={`Required ${type.name}`} className="field" defaultValue={type.required ? "1" : "0"}>
                  <option value="0">Optional</option>
                  <option value="1">Required</option>
                </select>
                <select name="archived" aria-label={`State ${type.name}`} className="field" defaultValue={type.archived ? "1" : "0"}>
                  <option value="0">Active</option>
                  <option value="1">Archived</option>
                </select>
              </div>
            ))}
            <input name="typeId" type="hidden" value="" />
            <input name="name" aria-label="New type" className="field" placeholder="New type" />
            <div className="grid grid-cols-2 gap-2">
              <select name="required" aria-label="New required" className="field" defaultValue="0">
                <option value="0">Optional</option>
                <option value="1">Required</option>
              </select>
              <select name="archived" aria-label="New state" className="field" defaultValue="0">
                <option value="0">Active</option>
                <option value="1">Archived</option>
              </select>
            </div>
            <button type="submit" className="ctl h-9">
              Save
            </button>
          </ActionForm>
        ) : (
          <ul className="fl-group">
            {types.filter((type) => !type.archived).map((type) => (
              <li key={type.id} className="fl-cell">
                <span className="flex-1">{type.name}</span>
                {type.required ? <span className="fl-pill">Required</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
