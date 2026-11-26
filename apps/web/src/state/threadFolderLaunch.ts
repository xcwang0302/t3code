import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadFolder } from "@t3tools/client-runtime/state/thread-folders";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { readProjects } from "./entities";
import { readPendingThreadFolder, setPendingThreadFolder } from "./pendingThreadFolders";
import { moveThreadsToFolder } from "./threadFolders";

/**
 * Files a just-created thread into the folder its draft was opened from. A draft sent to another
 * environment cannot join a folder there, so it stays unfiled and says why.
 */
export async function filePendingThreadFolder(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): Promise<void> {
  const pending = readPendingThreadFolder(threadId);
  if (pending === null) return;
  setPendingThreadFolder(threadId, null);
  if (pending.environmentId !== environmentId) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: m(msg("Thread not added to its folder")),
        description: m(msg("The thread started on another environment than the folder.")),
      }),
    );
    return;
  }
  await moveThreadsToFolder({ environmentId, threadIds: [threadId], folderId: pending.folderId });
}

const trimTrailingSeparators = (path: string) =>
  path.length > 1 ? path.replace(/[\\/]+$/, "") || path : path;

/** Whether two directories name the same place, ignoring a trailing separator. */
export function sameWorkspaceRoot(left: string, right: string): boolean {
  return trimTrailingSeparators(left.trim()) === trimTrailingSeparators(right.trim());
}

/** The project a folder's directory belongs to on the folder's environment, if one exists. */
export function findThreadFolderProject(
  folder: Pick<EnvironmentThreadFolder, "environmentId" | "workspaceRoot">,
  projects: ReadonlyArray<EnvironmentProject> = readProjects(),
): EnvironmentProject | null {
  const { workspaceRoot } = folder;
  if (workspaceRoot === null || workspaceRoot.trim() === "") return null;
  return (
    projects.find(
      (project) =>
        project.environmentId === folder.environmentId &&
        sameWorkspaceRoot(project.workspaceRoot, workspaceRoot),
    ) ?? null
  );
}
