import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { GripVerticalIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { cn } from "../../lib/utils";
import { hostRightPanel } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentShellHasSnapshot } from "../../state/shell";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { BackgroundThreadContext } from "./backgroundThread";
import { openSplitThread } from "./splitThreadNavigation";
import { splitThreadDragHandlers } from "./SplitThreadFrame";

/**
 * The other thread of a split, beside or below the main one. Its panel actions open in the main
 * thread's panel. Its grip drags it to another side or into tabs; Close only ends the split.
 */
export default function SplitThreadPane(props: {
  readonly hostRef: ScopedThreadRef;
  readonly threadId: ThreadId;
  readonly hostPanel: SideChatParentPanel;
  readonly onClose: () => void;
  /** Left or top of the split, where a collapsed sidebar leaves the window controls. */
  readonly leading: boolean;
}) {
  const { hostRef, threadId } = props;
  const gt = useGT();
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(hostRef.environmentId, threadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the host panel in the panel store
  useEffect(
    () => hostRightPanel(scopeThreadRef(hostRef.environmentId, threadId), hostRef),
    [hostRef, threadId],
  );
  const shell = useQuietThreadShell(threadRef);
  const isDraft = useComposerDraftStore(
    (state) => state.getDraftThreadByRef(scopeThreadRef(hostRef.environmentId, threadId)) !== null,
  );
  const snapshotLoaded = useEnvironmentShellHasSnapshot(hostRef.environmentId);

  return (
    // The side chat marker keeps this column's keys, scrolling and focus apart from the main thread's.
    <div
      data-side-chat-pane={threadId}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border pr-3 pl-1",
          props.leading && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        {/* Close sits left: with the panel closed, the window's panel controls cover the right end. */}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close split view")}
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
        <span
          draggable
          {...splitThreadDragHandlers(threadId)}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-1 active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm font-medium">
            {shell?.title ?? (isDraft ? gt("New thread") : gt("Thread"))}
          </span>
        </span>
      </div>
      {shell !== null ? (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={hostRef.environmentId}
              threadId={threadId}
              routeKind="server"
              embedded={props.hostPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      ) : isDraft ? (
        <div className="flex flex-col items-start gap-2 p-3 text-xs text-muted-foreground">
          <T>This new thread has no messages yet.</T>
          <Button variant="outline" size="xs" onClick={() => openSplitThread(navigate, threadRef)}>
            <T>Open thread</T>
          </Button>
        </div>
      ) : snapshotLoaded ? (
        <p className="p-3 text-xs text-muted-foreground">
          <T>This thread is no longer available.</T>
        </p>
      ) : null}
    </div>
  );
}
