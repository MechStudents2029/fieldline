import Link from "next/link";
import {
  addJobFolderAction,
  archiveJobFolderAction,
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
import { jobSectionTabs } from "@/components/job-section-tabs";
import { Toolbar } from "@/components/mac/toolbar";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { jobFileBoard } from "@/lib/services/files";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.pdf";

function folderHref(projectId: string, folderId: string, view: string) {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (view === "attached") params.set("view", "attached");
  const query = params.toString();
  return `/projects/${projectId}/files${query ? `?${query}` : ""}`;
}

export default async function JobFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ folder?: string; view?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  const board = jobFileBoard(session, id);
  if (!board) return <MissingRecord orgName={session.orgName} kind="job" />;
  const view = query.view === "attached" ? "attached" : "files";
  const folderId = board.folders.some((folder) => folder.id === query.folder) ? query.folder || "" : "";
  const files = folderId ? board.files.filter((file) => file.folderId === folderId) : board.files;
  const uploadFolders = board.folders.filter((folder) => !folder.vendor);
  const uploadFolder = board.canAddPhoto ? board.photoFolderId : folderId || uploadFolders[0]?.id || "";
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title={board.projectName} subtitle={board.address} search={false} center={jobSectionTabs(board.projectId, "files")} />
      </div>
      <div className="px-4 py-4 md:px-0">
        <div className="mb-4 md:hidden">
          <Link href={`/projects/${board.projectId}`} className="text-[var(--fl-accent)]">
            ‹ Job
          </Link>
          <h1 className="fl-title mt-2">Files</h1>
        </div>
        <div className="mb-4 flex gap-4 px-0 md:px-4">
          <Link href={folderHref(board.projectId, folderId, "files")} aria-current={view === "files" ? "page" : undefined} className={view === "files" ? "font-semibold text-[var(--fl-accent)]" : ""}>
            Files
          </Link>
          <Link href={folderHref(board.projectId, folderId, "attached")} aria-current={view === "attached" ? "page" : undefined} className={view === "attached" ? "font-semibold text-[var(--fl-accent)]" : ""}>
            Attached
          </Link>
        </div>
        {view === "files" ? (
          <div className="md:grid md:grid-cols-[180px_minmax(0,1fr)]">
            <nav aria-label="Folders" className="mb-4 flex gap-3 overflow-x-auto md:mb-0 md:flex-col md:px-4">
              <Link href={folderHref(board.projectId, "", view)} aria-current={folderId ? undefined : "page"} className="text-sm">
                All
              </Link>
              {board.folders.map((folder) => (
                <Link key={folder.id} href={folderHref(board.projectId, folder.id, view)} aria-current={folder.id === folderId ? "page" : undefined} className="text-sm whitespace-nowrap">
                  {folder.name}
                  <span className="fl-pill ml-2">{folder.visibilityLabel}</span>
                </Link>
              ))}
            </nav>
            <div className="min-w-0">
              <div className="hidden overflow-x-auto md:block">
                <table className="mac-table" aria-label="Files">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Folder</th>
                      <th>By</th>
                      <th>Date</th>
                      <th>Size</th>
                      <th>Visibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No files</td>
                      </tr>
                    ) : null}
                    {files.map((file) => (
                      <tr key={file.id}>
                        <td>
                          <a href={`/api/files/${file.documentId}`}>{file.name}</a>
                          {file.plans ? <span className="ml-2 text-[var(--mac-secondary)]">Rev {file.revision} · {file.current ? "Current" : "Superseded"}</span> : null}
                        </td>
                        <td>{file.folderName}</td>
                        <td>{file.uploadedBy}</td>
                        <td>{formatCalendarDay(file.createdAt)}</td>
                        <td>{file.sizeLabel}</td>
                        <td>
                          <span className="fl-pill">{file.visibilityLabel}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden" aria-label="Files">
                {files.length === 0 ? <li className="py-3 text-sm">No files</li> : null}
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-3 border-b border-[var(--mac-line)] py-3">
                    <span className="min-w-0 flex-1">
                      <a href={`/api/files/${file.documentId}`} className="block truncate">
                        {file.name}
                      </a>
                      <span className="block text-sm text-[var(--mac-secondary)]">
                        {file.folderName} · {formatCalendarDay(file.createdAt)} · {file.sizeLabel}
                        {file.plans ? ` · Rev ${file.revision}` : ""}
                        {file.superseded ? " · Superseded" : ""}
                        {file.plans && file.current ? " · Current" : ""}
                      </span>
                    </span>
                    <span className="fl-pill">{file.visibilityLabel}</span>
                  </li>
                ))}
              </ul>
              {board.canEdit && uploadFolder ? (
                <ActionForm action={uploadJobFileAction.bind(null, board.projectId)} className="mt-4 grid gap-2 md:px-4">
                  <label className="text-sm">
                    Folder
                    <select name="folderId" aria-label="Folder" defaultValue={uploadFolder} className="field mt-1">
                      {uploadFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <FileButton name="file" label="File" accept={ACCEPT} empty="File" />
                  <button type="submit" className="mac-primary w-fit">
                    Upload
                  </button>
                </ActionForm>
              ) : null}
              {board.canAddPhoto && board.photoFolderId ? (
                <ActionForm action={uploadJobFileAction.bind(null, board.projectId)} className="mt-4 grid gap-2">
                  <input type="hidden" name="folderId" value={board.photoFolderId} />
                  <FileButton name="file" label="Photo" accept="image/jpeg,image/png,image/webp" empty="Photo" />
                  <button type="submit" className="mac-primary w-fit">
                    Add photo
                  </button>
                </ActionForm>
              ) : null}
              {board.canEdit
                ? files
                    .filter((file) => file.plans && file.current)
                    .map((file) => (
                      <div key={file.id} className="mt-4 grid gap-2 md:px-4">
                        <p className="text-sm">
                          {file.name} · Rev {file.revision}
                        </p>
                        <ActionForm action={reviseJobFileAction.bind(null, board.projectId, file.id)} className="flex flex-wrap items-center gap-2">
                          <FileButton name="file" label={`Revise ${file.name}`} accept={ACCEPT} empty="File" />
                          <button type="submit">Revise</button>
                        </ActionForm>
                        <ActionForm action={shareFileHistoryAction.bind(null, board.projectId, file.id)} className="flex items-center gap-2">
                          <input type="hidden" name="share" value={file.shareHistory ? "0" : "1"} />
                          <button type="submit">{file.shareHistory ? "Hide history" : "Share history"}</button>
                        </ActionForm>
                      </div>
                    ))
                : null}
              {board.canEdit ? (
                <div className="mt-4 grid gap-3 md:px-4">
                  {files.map((file) => (
                    <div key={`edit-${file.id}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">{file.name}</span>
                      <ActionForm action={setFileVisibilityAction.bind(null, board.projectId, file.id)} className="flex items-center gap-2">
                        <label className="text-sm">
                          Visibility
                          <select name="visibility" aria-label={`Visibility ${file.name}`} defaultValue="inherit" className="field ml-2">
                            <option value="inherit">Folder</option>
                            <option value="team">Team</option>
                            <option value="client">Client</option>
                            <option value="subs">Subs</option>
                          </select>
                        </label>
                        <button type="submit">Save</button>
                      </ActionForm>
                      <ActionForm action={deleteJobFileAction.bind(null, board.projectId, file.id)}>
                        <button type="submit">Delete</button>
                      </ActionForm>
                    </div>
                  ))}
                  <details>
                    <summary>Folders</summary>
                    <ActionForm action={addJobFolderAction.bind(null, board.projectId)} className="mt-3 grid gap-2">
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
                      <button type="submit" className="w-fit">
                        Add folder
                      </button>
                    </ActionForm>
                    {uploadFolders.map((folder) => (
                      <div key={folder.id} className="mt-3 grid gap-2">
                        <ActionForm action={renameJobFolderAction.bind(null, board.projectId, folder.id)} className="flex flex-wrap items-end gap-2">
                          <label className="text-sm">
                            Name
                            <input name="name" required defaultValue={folder.name} aria-label={`Rename ${folder.name}`} className="field mt-1" />
                          </label>
                          <button type="submit">Rename</button>
                        </ActionForm>
                        <ActionForm action={setFolderVisibilityAction.bind(null, board.projectId, folder.id)} className="flex items-center gap-2">
                          <select name="visibility" aria-label={`Folder visibility ${folder.name}`} defaultValue={folder.visibility} className="field">
                            <option value="team">Team</option>
                            <option value="client">Client</option>
                            <option value="subs">Subs</option>
                          </select>
                          <button type="submit">Save</button>
                        </ActionForm>
                        <ActionForm action={archiveJobFolderAction.bind(null, board.projectId, folder.id)}>
                          <button type="submit">Archive {folder.name}</button>
                        </ActionForm>
                      </div>
                    ))}
                  </details>
                </div>
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
                {board.attached.length === 0 ? (
                  <tr>
                    <td colSpan={2}>No files</td>
                  </tr>
                ) : null}
                {board.attached.map((row) => (
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
    </div>
  );
}
