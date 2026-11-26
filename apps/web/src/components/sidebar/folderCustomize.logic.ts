import type { ProjectIconOverride, ThreadFolder, ThreadFolderMutation } from "@t3tools/contracts";

export interface FolderCustomizeDraft {
  readonly name: string;
  readonly icon: ProjectIconOverride | null;
  /** The directory field as typed; blank unbinds the folder. */
  readonly workspaceRoot: string;
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

type FolderUpdate = Extract<ThreadFolderMutation, { type: "folder.update" }>;

/** One `folder.update` carrying only what changed, or null when nothing did. */
export function buildFolderUpdate(
  folder: Pick<ThreadFolder, "id" | "name" | "icon" | "workspaceRoot">,
  draft: FolderCustomizeDraft,
): FolderUpdate | null {
  const name = draft.name.trim();
  const workspaceRoot = draft.workspaceRoot.trim() || null;
  const update: FolderUpdate = {
    type: "folder.update",
    folderId: folder.id,
    ...(name !== "" && name !== folder.name ? { name } : {}),
    ...(!sameJson(draft.icon, folder.icon) ? { icon: draft.icon } : {}),
    ...(workspaceRoot !== folder.workspaceRoot ? { workspaceRoot } : {}),
  };
  return Object.keys(update).length > 2 ? update : null;
}
