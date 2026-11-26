import type { ScopedThreadRef } from "@t3tools/contracts";
import type { useNavigate } from "@tanstack/react-router";

import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { readThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";

/** The draft route of a thread that has not sent its first message yet. */
function findSplitDraftId(ref: ScopedThreadRef): DraftId | null {
  for (const [draftId, draft] of Object.entries(
    useComposerDraftStore.getState().draftThreadsByThreadKey,
  )) {
    if (draft.environmentId === ref.environmentId && draft.threadId === ref.threadId) {
      return DraftId.make(draftId);
    }
  }
  return null;
}

/** Shows a split's thread in the main view, as a saved thread or as the draft it still is. */
export function openSplitThread(navigate: ReturnType<typeof useNavigate>, ref: ScopedThreadRef) {
  if (readThreadShell(ref) !== null) {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    return;
  }
  const draftId = findSplitDraftId(ref);
  if (draftId !== null) void navigate({ to: "/draft/$draftId", params: { draftId } });
}
