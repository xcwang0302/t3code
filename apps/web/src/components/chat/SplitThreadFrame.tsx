import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { Columns2Icon, GripVerticalIcon, XIcon } from "lucide-react";
import { type DragEvent, type PointerEvent, type ReactNode, useRef } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import {
  type SplitDropZone,
  splitDropZoneAt,
  type SplitThreadLayout,
  useSplitDragStore,
  useSplitThreadStore,
} from "../../splitThreadStore";
import { useQuietThreadShell } from "../../state/entities";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { Button } from "../ui/button";
import { openSplitThread } from "./splitThreadNavigation";

const SPLIT_THREAD_DRAG_TYPE = "application/x-t3code-split-thread";

const isSplitDrag = (event: DragEvent<HTMLElement>) =>
  event.dataTransfer.types.includes(SPLIT_THREAD_DRAG_TYPE);

/** Makes an element drag one of a split's threads to another side, or into tabs. */
export function splitThreadDragHandlers(threadId: ThreadId) {
  return {
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(SPLIT_THREAD_DRAG_TYPE, threadId);
      event.dataTransfer.effectAllowed = "move";
      useSplitDragStore.setState({ dragging: threadId, zone: null });
    },
    onDragEnd: () => useSplitDragStore.setState({ dragging: null, zone: null }),
  };
}

const ZONE_HIGHLIGHT: Record<SplitDropZone, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
  center: "inset-6",
};

/**
 * The main thread's column and, in a split, the other thread beside it, below it, or merged with
 * it into tabs. Always renders the same wrapper so the main column never remounts.
 */
export function SplitThreadFrame(props: {
  readonly hostRef: ScopedThreadRef | null;
  readonly layout: SplitThreadLayout | null;
  /** The right panel is maximized; the main column has no width. */
  readonly collapsed: boolean;
  readonly partner: ReactNode;
  readonly children: ReactNode;
}) {
  const { hostRef, layout } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useSplitDragStore((state) => state.dragging);
  const zone = useSplitDragStore((state) => state.zone);
  const split = layout !== null && hostRef !== null && !props.collapsed ? layout : null;
  const mode = split?.mode ?? "row";
  const hostFirst = split === null || split.first === hostRef?.threadId;
  const hostShare =
    split === null || mode === "tabs" ? 1 : hostFirst ? split.ratio : 1 - split.ratio;

  const zoneAt = (event: DragEvent<HTMLElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    return rect ? splitDropZoneAt(rect, event.clientX, event.clientY) : null;
  };
  // Capture phase: the composer's editor must not take the drop as text.
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (split === null || !isSplitDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const next = zoneAt(event);
    if (useSplitDragStore.getState().zone !== next) useSplitDragStore.setState({ zone: next });
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (split === null || hostRef === null || !isSplitDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const dragged = event.dataTransfer.getData(SPLIT_THREAD_DRAG_TYPE);
    const target = zoneAt(event);
    useSplitDragStore.setState({ dragging: null, zone: null });
    if (dragged.length === 0 || target === null) return;
    useSplitThreadStore.getState().place(hostRef, ThreadId.make(dragged), target);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isSplitDrag(event)) return;
    const next = event.relatedTarget;
    if (next instanceof Node && frameRef.current?.contains(next)) return;
    useSplitDragStore.setState({ zone: null });
  };

  return (
    <div
      ref={frameRef}
      className={cn(
        "relative flex min-h-0 min-w-0",
        props.collapsed ? "w-0 flex-none" : "flex-1",
        mode === "row" ? "flex-row" : "flex-col",
      )}
      onDragOverCapture={onDragOver}
      onDropCapture={onDrop}
      onDragLeave={onDragLeave}
    >
      {split !== null && hostRef !== null && mode === "tabs" ? (
        <SplitThreadTabs hostRef={hostRef} layout={split} />
      ) : null}
      <div
        className="flex min-h-0 min-w-0"
        style={{ flex: `${hostShare} 1 0%`, order: hostFirst ? 0 : 2 }}
      >
        {props.children}
      </div>
      {split !== null && hostRef !== null && mode !== "tabs" ? (
        <>
          <SplitThreadResizer hostRef={hostRef} layout={split} frameRef={frameRef} />
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${1 - hostShare} 1 0%`, order: hostFirst ? 2 : 0 }}
          >
            {props.partner}
          </div>
        </>
      ) : null}
      {split !== null && dragging !== null && zone !== null ? (
        <div className="pointer-events-none absolute inset-0 z-40">
          <div
            className={cn(
              "absolute rounded-md border-2 border-primary bg-primary/10",
              ZONE_HIGHLIGHT[zone],
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

function SplitThreadResizer(props: {
  readonly hostRef: ScopedThreadRef;
  readonly layout: SplitThreadLayout;
  readonly frameRef: React.RefObject<HTMLDivElement | null>;
}) {
  const gt = useGT();
  const row = props.layout.mode === "row";
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = props.frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const ratio = row
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;
    useSplitThreadStore.getState().setRatio(props.hostRef, ratio);
  };
  return (
    <div
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label={gt("Resize split view")}
      className={cn(
        "relative z-10 shrink-0 bg-border hover:bg-primary/50",
        row ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
      style={{ order: 1 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onDoubleClick={() => useSplitThreadStore.getState().setRatio(props.hostRef, 0.5)}
    >
      <div className={cn("absolute", row ? "inset-y-0 -inset-x-1.5" : "inset-x-0 -inset-y-1.5")} />
    </div>
  );
}

function SplitThreadTabs(props: {
  readonly hostRef: ScopedThreadRef;
  readonly layout: SplitThreadLayout;
}) {
  const gt = useGT();
  const { hostRef, layout } = props;
  return (
    <div
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border px-2",
        isElectron && "drag-region",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      style={{ order: -1 }}
    >
      {[layout.first, layout.second].map((threadId) => (
        <SplitThreadTab
          key={threadId}
          threadRef={scopeThreadRef(hostRef.environmentId, threadId)}
          active={threadId === hostRef.threadId}
        />
      ))}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={gt("Show side by side")}
        onClick={() => useSplitThreadStore.getState().setMode(hostRef, "row")}
      >
        <Columns2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={gt("Close split view")}
        onClick={() => useSplitThreadStore.getState().close(hostRef)}
      >
        <XIcon />
      </Button>
    </div>
  );
}

function SplitThreadTab(props: { readonly threadRef: ScopedThreadRef; readonly active: boolean }) {
  const gt = useGT();
  const navigate = useNavigate();
  const shell = useQuietThreadShell(props.threadRef);
  const isDraft = useComposerDraftStore(
    (state) => state.getDraftThreadByRef(props.threadRef) !== null,
  );
  return (
    <div
      draggable
      {...splitThreadDragHandlers(props.threadRef.threadId)}
      role="tab"
      aria-selected={props.active}
      tabIndex={0}
      onClick={() => {
        if (!props.active) openSplitThread(navigate, props.threadRef);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !props.active) {
          event.preventDefault();
          openSplitThread(navigate, props.threadRef);
        }
      }}
      className={cn(
        "flex max-w-60 min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm [-webkit-app-region:no-drag]",
        props.active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60",
      )}
    >
      <GripVerticalIcon className="size-3.5 shrink-0 cursor-grab opacity-60" />
      <span className="min-w-0 truncate">
        {shell?.title ?? (isDraft ? gt("New thread") : gt("Thread"))}
      </span>
    </div>
  );
}
