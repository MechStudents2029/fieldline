import { JobFilesWorkspace } from "@/components/job-files-workspace";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { jobFileBoard } from "@/lib/services/files";

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
  return (
    <JobFilesWorkspace
      projectId={board.projectId}
      projectName={board.projectName}
      address={board.address}
      folders={board.folders}
      files={board.files}
      attached={board.attached}
      canEdit={board.canEdit}
      canAddPhoto={board.canAddPhoto}
      photoFolderId={board.photoFolderId}
      view={view}
      folderId={folderId}
    />
  );
}
