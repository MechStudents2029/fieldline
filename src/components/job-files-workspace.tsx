"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  type ActionState,
  addJobFolderAction,
  archiveJobFolderAction,
  bulkJobFilesAction,
  deleteJobFileAction,
  renameJobFolderAction,
  reviseJobFileAction,
  setFileVisibilityAction,
  setFolderVisibilityAction,
  shareFileHistoryAction,
  uploadJobFileAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { SelectionBar } from "@/components/selection-bar";
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCalendarDay } from "@/lib/format";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.pdf";

type Folder = {
  id: string;
  name: string;
  kind: string;
  visibility: string;
  visibilityLabel: string;
  vendor: boolean;
};

type JobFile = {
  id: string;
  documentId: string;
  name: string;
  folderId: string;
  folderName: string;
  revision: number;
  revisionGroupId: string;
  current: boolean;
  superseded: boolean;
  plans: boolean;
  shareHistory: boolean;
  visibility: string;
  visibilityLabel: string;
  visibilityOverride: string | null;
  uploadedBy: string;
  createdAt: string;
  sizeLabel: string;
};

type Attached = { id: string; name: string; record: string; href: string; fileHref: string };

function folderHref(projectId: string, folderId: string, view: string) {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (view === "attached") params.set("view", "attached");
  const query = params.toString();
  return `/projects/${projectId}/files${query ? `?${query}` : ""}`;
}

function AddFolderForm({ projectId }: { projectId: string }) {
  const action = useMemo(() => addJobFolderAction.bind(null, projectId), [projectId]);
  return (
    <ActionForm action={action} className="grid gap-2">
      <label className="text-sm">
        Name
        <input name="name" required aria-label="Folder name" className="field mt-1" />
      </label>
      <label className="text-sm">
        Type
        <select name="kind" aria-label="Folder type" className="field mt-1" defaultValue="general">
          <option value="general">General</option>
          <option value="plans">Plans</option>
          <option value="photos">Photos</option>
        </select>
      </label>
      <label className="text-sm">
        Visibility
        <select name="visibility" aria-label="New folder visibility" className="field mt-1" defaultValue="team">
          <option value="team">Team</option>
          <option value="client">Client</option>
          <option value="subs">Subs</option>
        </select>
      </label>
      <button type="submit" className="ctl">
        Add folder
      </button>
    </ActionForm>
  );
}

function FolderEditor({ projectId, folder }: { projectId: string; folder: Folder }) {
  const rename = useMemo(() => renameJobFolderAction.bind(null, projectId, folder.id), [projectId, folder.id]);
  const visibility = useMemo(() => setFolderVisibilityAction.bind(null, projectId, folder.id), [projectId, folder.id]);
  const archive = useMemo(() => archiveJobFolderAction.bind(null, projectId, folder.id), [projectId, folder.id]);
  return (
    <div className="grid gap-2 border-t border-[var(--mac-separator)] pt-3">
      <ActionForm action={rename} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Name
          <input name="name" required defaultValue={folder.name} aria-label={`Rename ${folder.name}`} className="field mt-1" />
        </label>
        <button type="submit" className="ctl">Rename</button>
      </ActionForm>
      <ActionForm action={visibility} className="ctl-line">
        <select name="visibility" aria-label={`Folder visibility ${folder.name}`} defaultValue={folder.visibility} className="ctl">
          <option value="team">Team</option>
          <option value="client">Client</option>
          <option value="subs">Subs</option>
        </select>
        <button type="submit" className="ctl">Save</button>
      </ActionForm>
      <ActionForm action={archive}>
        <button type="submit" className="ctl">Archive {folder.name}</button>
      </ActionForm>
    </div>
  );
}

function FilePane({
  projectId,
  file,
  history,
  canEdit,
  onSelect,
  onBack,
}: {
  projectId: string;
  file: JobFile;
  history: JobFile[];
  canEdit: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const visibilityAction = useMemo(() => setFileVisibilityAction.bind(null, projectId, file.id), [projectId, file.id]);
  const reviseAction = useMemo(() => reviseJobFileAction.bind(null, projectId, file.id), [projectId, file.id]);
  const shareAction = useMemo(() => shareFileHistoryAction.bind(null, projectId, file.id), [projectId, file.id]);
  const deleteAction = useMemo(() => deleteJobFileAction.bind(null, projectId, file.id), [projectId, file.id]);
  return (
    <aside aria-label="File" data-pane="file" className="flex w-full shrink-0 flex-col gap-3 border-t border-[var(--mac-separator)] px-4 py-4 md:w-[300px] md:border-t-0 md:border-l">
      <button type="button" className="w-fit text-sm text-[var(--fl-accent)] md:hidden" onClick={onBack}>
        ‹ Files
      </button>
      <div>
        <h2 className="mac-t15">{file.name}</h2>
        <p className="text-sm text-[var(--mac-secondary)]">{file.folderName}</p>
      </div>
      <a href={`/api/files/${file.documentId}`}>Open</a>
      {file.plans ? (
        <div>
          <p className="mac-t11 text-[var(--mac-secondary)]">Revisions</p>
          <ul className="mt-1">
            {history.map((rev) => (
              <li key={rev.id}>
                <button type="button" className="fit bg-transparent p-0 text-left" onClick={() => onSelect(rev.id)}>
                  Rev {rev.revision} · {rev.current ? "Current" : "Superseded"} · {formatCalendarDay(rev.createdAt)} · {rev.uploadedBy}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[var(--mac-secondary)]">
          {formatCalendarDay(file.createdAt)} · {file.uploadedBy} · {file.sizeLabel}
        </p>
      )}
      {canEdit ? (
        <ActionForm action={visibilityAction} className="ctl-line">
          <label className="ctl-line">
            Visibility
            <select
              name="visibility"
              aria-label={`Visibility ${file.name}`}
              defaultValue={file.visibilityOverride ?? "inherit"}
              className="ctl"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="inherit">Folder</option>
              <option value="team">Team</option>
              <option value="client">Client</option>
              <option value="subs">Subs</option>
            </select>
          </label>
        </ActionForm>
      ) : (
        <span className="fl-pill w-fit">{file.visibilityLabel}</span>
      )}
      {canEdit && file.plans && file.current ? (
        <ActionForm action={reviseAction} className="ctl-line">
          <FileButton name="file" label={`Revise ${file.name}`} accept={ACCEPT} empty="File" />
          <button type="submit" className="ctl">Upload new revision</button>
        </ActionForm>
      ) : null}
      {canEdit && file.plans && file.current ? (
        <ActionForm action={shareAction}>
          <input type="hidden" name="share" value={file.shareHistory ? "0" : "1"} />
          <button type="submit" className="ctl">{file.shareHistory ? "Hide history" : "Share history"}</button>
        </ActionForm>
      ) : null}
      {canEdit ? (
        <ActionForm action={deleteAction}>
          <button type="submit" className="ctl">Delete</button>
        </ActionForm>
      ) : null}
    </aside>
  );
}

export function JobFilesWorkspace({
  projectId,
  projectName,
  address,
  folders,
  files,
  attached,
  canEdit,
  canAddPhoto,
  photoFolderId,
  view,
  folderId,
}: {
  projectId: string;
  projectName: string;
  address: string;
  folders: Folder[];
  files: JobFile[];
  attached: Attached[];
  canEdit: boolean;
  canAddPhoto: boolean;
  photoFolderId: string | null;
  view: "files" | "attached";
  folderId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const canUpload = canEdit || canAddPhoto;
  const uploadAct = useMemo(() => uploadJobFileAction.bind(null, projectId), [projectId]);
  const bulkAct = useMemo(() => bulkJobFilesAction.bind(null, projectId), [projectId]);
  const uploadAndClose = useMemo(
    () => async (state: ActionState, formData: FormData) => {
      const result = await uploadAct(state, formData);
      if (result && "ok" in result && result.ok) setUploadOpen(false);
      return result;
    },
    [uploadAct],
  );
  const [uploadState, uploadForm] = useActionState(uploadAndClose, null);
  const visible = folderId ? files.filter((file) => file.folderId === folderId) : files;
  const selected = visible.find((file) => file.id === selectedId) ?? null;
  const vendorIds = new Set(folders.filter((folder) => folder.vendor).map((folder) => folder.id));
  const officeFolders = folders.filter((folder) => !folder.vendor);
  const picked = checked.filter((id) => visible.some((file) => file.id === id && !vendorIds.has(file.folderId)));
  const selectable = visible.filter((file) => !vendorIds.has(file.folderId));
  const defaultFolder =
    canAddPhoto && !canEdit
      ? photoFolderId || ""
      : selected && officeFolders.some((folder) => folder.id === selected.folderId)
        ? selected.folderId
        : officeFolders.some((folder) => folder.id === folderId)
          ? folderId
          : officeFolders[0]?.id || "";
  function toggle(id: string) {
    setChecked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }
  function toggleAll() {
    setChecked(picked.length === selectable.length ? [] : selectable.map((file) => file.id));
  }
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title={projectName}
          subtitle={address}
          center={jobSectionTabs(projectId, "files")}
          primary={canUpload ? "Upload" : undefined}
          onPrimary={canUpload ? () => setUploadOpen(true) : undefined}
          trailing={
            canEdit ? (
              <button type="button" className="mac-glass-btn" onClick={() => setFoldersOpen(true)}>
                Folders
              </button>
            ) : null
          }
        />
      </div>
      <div className="px-4 py-4 md:flex md:min-h-0 md:flex-1 md:flex-col md:px-0">
        <div className="mb-4 flex items-start justify-between gap-3 md:hidden">
          <div>
            <Link href={`/projects/${projectId}`} className="text-[var(--fl-accent)]">
              ‹ Job
            </Link>
            <h1 className="fl-title mt-2">Files</h1>
          </div>
          <span className="flex items-center gap-2">
            {canEdit ? (
              <button type="button" onClick={() => setFoldersOpen(true)}>
                Folders
              </button>
            ) : null}
            {canUpload ? (
              <button type="button" className="mac-primary" data-mac-primary onClick={() => setUploadOpen(true)}>
                Upload
              </button>
            ) : null}
          </span>
        </div>
        <div className="mb-4 flex gap-4 md:px-4">
          <Link href={folderHref(projectId, folderId, "files")} aria-current={view === "files" ? "page" : undefined} className={view === "files" ? "font-semibold text-[var(--fl-accent)]" : ""}>
            Files
          </Link>
          <Link href={folderHref(projectId, folderId, "attached")} aria-current={view === "attached" ? "page" : undefined} className={view === "attached" ? "font-semibold text-[var(--fl-accent)]" : ""}>
            Attached
          </Link>
        </div>
        {view === "files" ? (
          <div className="md:grid md:min-h-0 md:flex-1 md:grid-cols-[240px_minmax(0,1fr)]">
            <nav aria-label="Folders" className="mb-4 flex gap-3 overflow-x-auto md:mb-0 md:block md:w-[240px] md:overflow-x-hidden md:px-3">
              <Link href={folderHref(projectId, "", view)} aria-current={folderId ? undefined : "page"} className="shrink-0 py-1 text-sm md:block">
                All
              </Link>
              {folders.map((folder) => (
                <Link
                  key={folder.id}
                  href={folderHref(projectId, folder.id, view)}
                  aria-current={folder.id === folderId ? "page" : undefined}
                  className="flex shrink-0 items-center gap-2 py-1 text-sm md:w-full md:min-w-0 md:justify-between"
                >
                  <span className="min-w-0">{folder.name}</span>
                  <span className="fl-pill fl-pill-sm shrink-0">{folder.visibilityLabel}</span>
                </Link>
              ))}
            </nav>
            <div className="flex min-w-0 flex-col md:flex-row">
              <div className={`${selected ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col`}>
                {canEdit ? (
                  <form action={bulkAct}>
                    <SelectionBar label="Bulk actions" count={picked.length} onClear={() => setChecked([])}>
                      {picked.map((id) => (
                        <input key={id} type="hidden" name="fileId" value={id} />
                      ))}
                      <select name="visibility" aria-label="Bulk visibility" className="ctl" defaultValue="">
                        <option value="">Visibility</option>
                        <option value="inherit">Folder</option>
                        <option value="team">Team</option>
                        <option value="client">Client</option>
                        <option value="subs">Subs</option>
                      </select>
                      <select name="folderId" aria-label="Move to folder" className="ctl" defaultValue="">
                        <option value="">Folder</option>
                        {officeFolders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="ctl">Apply</button>
                      <button
                        type="button"
                        className="ctl"
                        onClick={() => {
                          for (const file of visible.filter((row) => picked.includes(row.id))) {
                            const link = document.createElement("a");
                            link.href = `/api/files/${file.documentId}`;
                            link.download = "";
                            document.body.appendChild(link);
                            link.click();
                            link.remove();
                          }
                        }}
                      >
                        Download
                      </button>
                    </SelectionBar>
                  </form>
                ) : null}
                <div className="hidden overflow-x-auto md:block">
                  <table className="mac-table mac-files" aria-label="Files">
                    <colgroup>
                      {canEdit ? <col className="files-check" /> : null}
                      <col className="files-name" />
                      <col className="files-folder" />
                      <col className="files-by" />
                      <col className="files-date" />
                      <col className="files-size" />
                      <col className="files-vis" />
                    </colgroup>
                    <thead>
                      <tr>
                        {canEdit ? (
                          <th className="px-2">
                            <input type="checkbox" aria-label="Select all" checked={selectable.length > 0 && picked.length === selectable.length} onChange={toggleAll} />
                          </th>
                        ) : null}
                        <th>Name</th>
                        <th className="fit" data-fit="folder">Folder</th>
                        <th className="fit" data-fit="by">By</th>
                        <th className="fit" data-fit="date">Date</th>
                        <th className="fit" data-fit="size">Size</th>
                        <th className="fit" data-fit="status">Visibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 ? (
                        <tr>
                          <td colSpan={canEdit ? 7 : 6}>No files</td>
                        </tr>
                      ) : null}
                      {visible.map((file) => (
                        <tr
                          key={file.id}
                          data-mac-row={`${file.name} ${file.folderName} ${file.uploadedBy} ${formatCalendarDay(file.createdAt)} ${file.plans ? "plans" : "file"}`}
                          className={selected?.id === file.id ? "is-selected" : undefined}
                          onClick={() => setSelectedId(file.id)}
                        >
                          {canEdit ? (
                            <td className="px-2" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.name} Rev ${file.revision}`}
                                checked={picked.includes(file.id)}
                                disabled={vendorIds.has(file.folderId)}
                                onChange={() => toggle(file.id)}
                              />
                            </td>
                          ) : null}
                          <td>
                            <span className="fit">{file.name}</span>
                            {file.plans ? (
                              <span className="fit ml-2 text-[var(--mac-secondary)]" data-fit="status">
                                Rev {file.revision} · {file.current ? "Current" : "Superseded"}
                              </span>
                            ) : null}
                          </td>
                          <td className="fit" data-fit="folder">{file.folderName}</td>
                          <td className="fit" data-fit="by">{file.uploadedBy}</td>
                          <td className="fit" data-fit="date">{formatCalendarDay(file.createdAt)}</td>
                          <td className="fit" data-fit="size">{file.sizeLabel}</td>
                          <td className="fit" data-fit="status">
                            <span className="fl-pill fl-pill-sm">{file.visibilityLabel}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden" aria-label="Files">
                  {visible.length === 0 ? <li className="py-3 text-sm">No files</li> : null}
                  {visible.map((file) => (
                    <li key={file.id} className="flex items-center gap-3 border-b border-[var(--mac-line)] py-3">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${file.name} Rev ${file.revision}`}
                          checked={picked.includes(file.id)}
                          disabled={vendorIds.has(file.folderId)}
                          onChange={() => toggle(file.id)}
                        />
                      ) : null}
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(file.id)}>
                        <span className="block truncate">{file.name}</span>
                        <span className="block text-sm text-[var(--mac-secondary)]">
                          {file.folderName} · {formatCalendarDay(file.createdAt)} · {file.sizeLabel}
                          {file.plans ? ` · Rev ${file.revision}` : ""}
                          {file.superseded ? " · Superseded" : ""}
                          {file.plans && file.current ? " · Current" : ""}
                        </span>
                      </button>
                      <span className="fl-pill fl-pill-sm">{file.visibilityLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {selected ? (
                <FilePane
                  projectId={projectId}
                  file={selected}
                  history={files.filter((row) => row.revisionGroupId === selected.revisionGroupId).sort((a, b) => b.revision - a.revision)}
                  canEdit={canEdit}
                  onSelect={setSelectedId}
                  onBack={() => setSelectedId(null)}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto md:px-4">
            <table className="mac-table" aria-label="Attached">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {attached.length === 0 ? (
                  <tr>
                    <td colSpan={2}>No files</td>
                  </tr>
                ) : null}
                {attached.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a href={row.fileHref}>{row.name}</a>
                    </td>
                    <td>
                      <Link href={row.href}>{row.record}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Upload</DialogTitle>
          </DialogHeader>
          <form action={uploadForm} className="grid gap-3" data-sheet="upload">
            {canAddPhoto && !canEdit ? <input type="hidden" name="folderId" value={photoFolderId || ""} /> : null}
            {canEdit ? (
              <label className="ctl-line">
                Folder
                <select name="folderId" aria-label="Folder" defaultValue={defaultFolder} className="ctl">
                  {officeFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <FileButton name="file" label={canAddPhoto && !canEdit ? "Photo" : "File"} accept={canAddPhoto && !canEdit ? "image/jpeg,image/png,image/webp" : ACCEPT} empty={canAddPhoto && !canEdit ? "Photo" : "File"} />
            <button type="submit" className="mac-primary w-fit">
              Upload
            </button>
            {uploadState?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {uploadState.error}
              </p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
      {canEdit ? (
        <Dialog open={foldersOpen} onOpenChange={setFoldersOpen}>
          <DialogContent aria-describedby={undefined} className="max-h-[80vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Folders</DialogTitle>
            </DialogHeader>
            <AddFolderForm projectId={projectId} />
            {officeFolders.map((folder) => (
              <FolderEditor key={folder.id} projectId={projectId} folder={folder} />
            ))}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
