import type { EnvironmentId, ThreadFolderId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";

// Kept apart from the folder actions so the new-thread handler can record a folder without
// loading toasts and folder state.

/** The folder a draft was opened from, filed once its first send creates the thread. */
export interface PendingThreadFolder {
  readonly environmentId: EnvironmentId;
  readonly folderId: ThreadFolderId;
}

/** Drafts outlive a reload, so their folder does too; a few stale entries are harmless. */
const MAX_PENDING_THREAD_FOLDERS = 50;

interface PendingThreadFolderState {
  /** Keyed by the draft's thread id, which the thread keeps when the draft is sent. */
  readonly byThreadId: Readonly<Record<string, PendingThreadFolder>>;
}

const isPendingThreadFolder = (value: unknown): value is PendingThreadFolder => {
  const entry = value as Partial<PendingThreadFolder> | null;
  return typeof entry?.environmentId === "string" && typeof entry.folderId === "string";
};

const usePendingThreadFolderStore = create<PendingThreadFolderState>()(
  persist(() => ({ byThreadId: {} }), {
    name: "t3code:pending-thread-folders:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    version: 1,
    merge: (persisted, current) => {
      const stored = (persisted as Partial<PendingThreadFolderState> | null)?.byThreadId;
      if (!stored || typeof stored !== "object") return current;
      return {
        ...current,
        byThreadId: Object.fromEntries(
          Object.entries(stored).filter(([, entry]) => isPendingThreadFolder(entry)),
        ),
      };
    },
  }),
);

/** Sets or clears the folder a draft's thread is filed into once it is sent. */
export function setPendingThreadFolder(
  threadId: ThreadId,
  folder: PendingThreadFolder | null,
): void {
  usePendingThreadFolderStore.setState(({ byThreadId }) => {
    const { [threadId]: previous, ...rest } = byThreadId;
    if (folder === null) return previous === undefined ? { byThreadId } : { byThreadId: rest };
    const kept = Object.entries(rest).slice(-(MAX_PENDING_THREAD_FOLDERS - 1));
    return { byThreadId: { ...Object.fromEntries(kept), [threadId]: folder } };
  });
}

export function readPendingThreadFolder(threadId: ThreadId): PendingThreadFolder | null {
  return usePendingThreadFolderStore.getState().byThreadId[threadId] ?? null;
}
