import type { Role } from "@/lib/permissions";
import { canEditCrm } from "@/lib/permissions";

export const FOLDER_VISIBILITIES = ["team", "client", "subs", "vendor"] as const;
export type FolderVisibility = (typeof FOLDER_VISIBILITIES)[number];

export const DEFAULT_JOB_FOLDERS = [
  { name: "Plans", kind: "plans", visibility: "team" as const, sort: 0 },
  { name: "Specs", kind: "general", visibility: "team" as const, sort: 1 },
  { name: "Contracts", kind: "general", visibility: "team" as const, sort: 2 },
  { name: "Photos", kind: "photos", visibility: "team" as const, sort: 3 },
];

export type FileViewer = { kind: "office" } | { kind: "field" } | { kind: "client" } | { kind: "vendor"; contactId: string };

export type FolderShape = {
  visibility: string;
  vendorContactId: string | null;
  archived: boolean;
  kind: string;
};

export type FileShape = {
  visibilityOverride: string | null;
  isCurrent: boolean;
  shareHistory: boolean;
  deleted: boolean;
};

export type AttachedKind = "rfi" | "submittal" | "bill" | "punch" | "log" | "bid" | "po";

const MONEY_ATTACHED = new Set<AttachedKind>(["bill", "po", "bid"]);

export function isFolderVisibility(value: string): value is FolderVisibility {
  return (FOLDER_VISIBILITIES as readonly string[]).includes(value);
}

export function viewerForRole(role: Role): FileViewer {
  return role === "field" ? { kind: "field" } : { kind: "office" };
}

export function officeMayEditFiles(role: Role): boolean {
  return canEditCrm(role);
}

export function effectiveVisibility(folder: string, override: string | null): FolderVisibility {
  if (override && isFolderVisibility(override) && override !== "vendor") return override;
  if (isFolderVisibility(folder)) return folder;
  return "team";
}

export function visibilityLabel(value: string): string {
  if (value === "client") return "Client";
  if (value === "subs") return "Subs";
  if (value === "vendor") return "Vendor";
  return "Team";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${rounded} MB`;
}

function vendorFolder(folder: FolderShape): boolean {
  return folder.kind === "vendor" || folder.visibility === "vendor";
}

export function folderVisible(viewer: FileViewer, folder: FolderShape): boolean {
  if (folder.archived) return false;
  if (vendorFolder(folder)) {
    if (viewer.kind === "office") return true;
    if (viewer.kind === "vendor") return folder.vendorContactId === viewer.contactId;
    return false;
  }
  const visibility = effectiveVisibility(folder.visibility, null);
  if (viewer.kind === "office" || viewer.kind === "field") return visibility !== "vendor";
  if (viewer.kind === "client") return visibility === "client";
  return visibility === "subs";
}

export function fileVisibleTo(viewer: FileViewer, folder: FolderShape, file: FileShape): boolean {
  if (file.deleted || !folderVisible(viewer, folder)) return false;
  if ((viewer.kind === "client" || viewer.kind === "vendor") && !file.isCurrent && !file.shareHistory) return false;
  const visibility = effectiveVisibility(folder.visibility, file.visibilityOverride);
  if (visibility === "vendor" || vendorFolder(folder)) {
    if (viewer.kind === "office") return true;
    if (viewer.kind === "vendor") return folder.vendorContactId === viewer.contactId;
    return false;
  }
  if (viewer.kind === "office" || viewer.kind === "field") return true;
  if (viewer.kind === "client") return visibility === "client";
  return visibility === "subs";
}

export function fieldMayAddPhoto(viewer: FileViewer, folder: FolderShape): boolean {
  return viewer.kind === "field" && folder.kind === "photos" && folderVisible(viewer, folder);
}

export function attachedVisible(
  viewer: FileViewer,
  row: { kind: AttachedKind; vendorContactId: string | null; logVisibility: string | null; punchShared: boolean; invited: boolean },
): boolean {
  if (viewer.kind === "office") return true;
  if (viewer.kind === "field") return !MONEY_ATTACHED.has(row.kind);
  if (viewer.kind === "client") {
    if (MONEY_ATTACHED.has(row.kind)) return false;
    if (row.kind === "log") return row.logVisibility === "client";
    if (row.kind === "punch") return row.punchShared;
    return false;
  }
  if (row.kind === "bid") return row.invited;
  if (row.kind === "log") return false;
  return row.vendorContactId === viewer.contactId;
}

export function displayFileName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const stem = base.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return stem.slice(0, 80) || "File";
}
