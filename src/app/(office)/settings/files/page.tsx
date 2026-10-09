import Link from "next/link";
import { saveFolderDefaultAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { folderDefaults } from "@/lib/services/files";

export default async function FileSettingsPage() {
  const session = await requireSession();
  if (!canManageSettings(session.role)) return null;
  const folders = folderDefaults(session) ?? [];
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <Link href="/settings" className="text-sm text-[var(--fl-accent)]">
        ‹ Settings
      </Link>
      <h1 className="fl-title">Files</h1>
      <ul className="flex flex-col gap-4" aria-label="Default folders">
        {folders.map((folder) => (
          <li key={folder.id}>
            <ActionForm action={saveFolderDefaultAction} className="grid gap-2">
              <input type="hidden" name="id" value={folder.id} />
              <label className="text-sm">
                Name
                <input name="name" required defaultValue={folder.name} aria-label={`Name ${folder.name}`} className="field mt-1" />
              </label>
              <label className="text-sm">
                Type
                <select name="kind" aria-label={`Type ${folder.name}`} defaultValue={folder.kind} className="field mt-1">
                  <option value="plans">Plans</option>
                  <option value="photos">Photos</option>
                  <option value="general">General</option>
                </select>
              </label>
              <label className="text-sm">
                Visibility
                <select name="visibility" aria-label={`Visibility ${folder.name}`} defaultValue={folder.visibility} className="field mt-1">
                  <option value="team">Team</option>
                  <option value="client">Client</option>
                  <option value="subs">Subs</option>
                </select>
              </label>
              <div className="flex gap-3">
                <button type="submit">Save</button>
                <button type="submit" name="archive" value="1">
                  Archive
                </button>
              </div>
            </ActionForm>
          </li>
        ))}
      </ul>
      <ActionForm action={saveFolderDefaultAction} className="grid gap-2">
        <label className="text-sm">
          Name
          <input name="name" required aria-label="New folder" className="field mt-1" />
        </label>
        <label className="text-sm">
          Type
          <select name="kind" aria-label="New type" defaultValue="general" className="field mt-1">
            <option value="general">General</option>
            <option value="plans">Plans</option>
            <option value="photos">Photos</option>
          </select>
        </label>
        <label className="text-sm">
          Visibility
          <select name="visibility" aria-label="New visibility" defaultValue="team" className="field mt-1">
            <option value="team">Team</option>
            <option value="client">Client</option>
            <option value="subs">Subs</option>
          </select>
        </label>
        <button type="submit" className="mac-primary w-fit">
          Add folder
        </button>
      </ActionForm>
    </div>
  );
}
