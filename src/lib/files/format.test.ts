import { describe, expect, it } from "vitest";
import {
  attachedVisible,
  effectiveVisibility,
  fieldMayAddPhoto,
  fileVisibleTo,
  folderVisible,
  formatFileSize,
  visibilityLabel,
  type FileShape,
  type FolderShape,
} from "@/lib/files/format";

const team: FolderShape = { visibility: "team", vendorContactId: null, archived: false, kind: "general" };
const plans: FolderShape = { visibility: "subs", vendorContactId: null, archived: false, kind: "plans" };
const photos: FolderShape = { visibility: "client", vendorContactId: null, archived: false, kind: "photos" };
const vendor: FolderShape = { visibility: "vendor", vendorContactId: "c_harbor", archived: false, kind: "vendor" };
const current: FileShape = { visibilityOverride: null, isCurrent: true, shareHistory: false, deleted: false };
const old: FileShape = { visibilityOverride: null, isCurrent: false, shareHistory: false, deleted: false };

describe("job file visibility", () => {
  it("keeps team as the default and lets a file override the folder", () => {
    expect(effectiveVisibility("team", null)).toBe("team");
    expect(effectiveVisibility("subs", "client")).toBe("client");
    expect(visibilityLabel("subs")).toBe("Subs");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("shows team and shared folders to field, and vendor folders only to that vendor", () => {
    expect(folderVisible({ kind: "field" }, team)).toBe(true);
    expect(folderVisible({ kind: "field" }, plans)).toBe(true);
    expect(folderVisible({ kind: "field" }, photos)).toBe(true);
    expect(folderVisible({ kind: "field" }, vendor)).toBe(false);
    expect(folderVisible({ kind: "client" }, photos)).toBe(true);
    expect(folderVisible({ kind: "client" }, plans)).toBe(false);
    expect(folderVisible({ kind: "client" }, team)).toBe(false);
    expect(folderVisible({ kind: "vendor", contactId: "c_harbor" }, plans)).toBe(true);
    expect(folderVisible({ kind: "vendor", contactId: "c_harbor" }, team)).toBe(false);
    expect(folderVisible({ kind: "vendor", contactId: "c_casa" }, vendor)).toBe(false);
    expect(folderVisible({ kind: "vendor", contactId: "c_harbor" }, vendor)).toBe(true);
    expect(folderVisible({ kind: "office" }, vendor)).toBe(true);
    expect(fieldMayAddPhoto({ kind: "field" }, photos)).toBe(true);
    expect(fieldMayAddPhoto({ kind: "field" }, plans)).toBe(false);
    expect(fieldMayAddPhoto({ kind: "office" }, photos)).toBe(false);
  });

  it("hides superseded plans on portals unless history is shared", () => {
    expect(fileVisibleTo({ kind: "office" }, plans, old)).toBe(true);
    expect(fileVisibleTo({ kind: "field" }, plans, old)).toBe(true);
    expect(fileVisibleTo({ kind: "vendor", contactId: "c_harbor" }, plans, old)).toBe(false);
    expect(fileVisibleTo({ kind: "vendor", contactId: "c_harbor" }, plans, current)).toBe(true);
    expect(fileVisibleTo({ kind: "client" }, plans, current)).toBe(false);
    expect(fileVisibleTo({ kind: "vendor", contactId: "c_harbor" }, plans, { ...old, shareHistory: true })).toBe(true);
    expect(fileVisibleTo({ kind: "client" }, photos, current)).toBe(true);
    expect(fileVisibleTo({ kind: "field" }, vendor, current)).toBe(false);
  });

  it("keeps money files off field and other vendors", () => {
    expect(attachedVisible({ kind: "field" }, { kind: "bill", vendorContactId: "c_harbor", logVisibility: null, punchShared: false, invited: false })).toBe(false);
    expect(attachedVisible({ kind: "field" }, { kind: "log", vendorContactId: null, logVisibility: "client", punchShared: false, invited: false })).toBe(true);
    expect(attachedVisible({ kind: "client" }, { kind: "bill", vendorContactId: "c_harbor", logVisibility: null, punchShared: false, invited: false })).toBe(false);
    expect(attachedVisible({ kind: "client" }, { kind: "log", vendorContactId: null, logVisibility: "client", punchShared: false, invited: false })).toBe(true);
    expect(attachedVisible({ kind: "client" }, { kind: "log", vendorContactId: null, logVisibility: "internal", punchShared: false, invited: false })).toBe(false);
    expect(attachedVisible({ kind: "vendor", contactId: "c_harbor" }, { kind: "submittal", vendorContactId: "c_harbor", logVisibility: null, punchShared: false, invited: false })).toBe(true);
    expect(attachedVisible({ kind: "vendor", contactId: "c_casa" }, { kind: "submittal", vendorContactId: "c_harbor", logVisibility: null, punchShared: false, invited: false })).toBe(false);
    expect(attachedVisible({ kind: "vendor", contactId: "c_casa" }, { kind: "bid", vendorContactId: null, logVisibility: null, punchShared: false, invited: true })).toBe(true);
    expect(attachedVisible({ kind: "vendor", contactId: "c_casa" }, { kind: "bid", vendorContactId: null, logVisibility: null, punchShared: false, invited: false })).toBe(false);
  });
});
