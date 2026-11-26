import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** Side by side, one above the other, or merged into one column with a tab for each. */
export type SplitThreadMode = "row" | "column" | "tabs";

/**
 * Two threads of one environment shown together, like a split view in a browser. Either thread
 * in the main view brings the other along; `first` is the left or top one.
 */
export interface SplitThreadLayout {
  readonly environmentId: EnvironmentId;
  readonly first: ThreadId;
  readonly second: ThreadId;
  readonly mode: SplitThreadMode;
  /** The first thread's share of the space, between 0.2 and 0.8. */
  readonly ratio: number;
}

export type SplitDropZone = "left" | "right" | "top" | "bottom" | "center";

const MAX_LAYOUTS = 50;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

const clampSplitRatio = (ratio: number) =>
  Number.isFinite(ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) : 0.5;

const contains = (layout: SplitThreadLayout, ref: ScopedThreadRef) =>
  layout.environmentId === ref.environmentId &&
  (layout.first === ref.threadId || layout.second === ref.threadId);

export function findSplitLayout(
  layouts: readonly SplitThreadLayout[],
  ref: ScopedThreadRef | null,
): SplitThreadLayout | null {
  if (ref === null) return null;
  return layouts.find((layout) => contains(layout, ref)) ?? null;
}

export function splitPartner(layout: SplitThreadLayout, threadId: ThreadId): ThreadId {
  return layout.first === threadId ? layout.second : layout.first;
}

/** The zone a drag over `rect` points at: an edge within a quarter of it, else the middle. */
export function splitDropZoneAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): SplitDropZone {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const edges = [
    ["left", (x - rect.left) / rect.width],
    ["right", (rect.left + rect.width - x) / rect.width],
    ["top", (y - rect.top) / rect.height],
    ["bottom", (rect.top + rect.height - y) / rect.height],
  ] as const;
  const nearest = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
  return nearest[1] < 0.25 ? nearest[0] : "center";
}

/** Moves `dragged`, one of the layout's threads, to `zone` of the whole split area. */
export function placeSplitThread(
  layout: SplitThreadLayout,
  dragged: ThreadId,
  zone: SplitDropZone,
): SplitThreadLayout {
  if (dragged !== layout.first && dragged !== layout.second) return layout;
  if (zone === "center") return { ...layout, mode: "tabs" };
  const other = splitPartner(layout, dragged);
  const leading = zone === "left" || zone === "top";
  const first = leading ? dragged : other;
  const second = leading ? other : dragged;
  const ratio =
    layout.mode === "tabs" ? 0.5 : first === layout.first ? layout.ratio : 1 - layout.ratio;
  return {
    ...layout,
    first,
    second,
    mode: zone === "left" || zone === "right" ? "row" : "column",
    ratio: clampSplitRatio(ratio),
  };
}

interface SplitThreadStoreState {
  readonly layouts: readonly SplitThreadLayout[];
  /**
   * Shows `threadId` after `host`, side by side. Either thread leaves any split it was in. A thread
   * is never split with itself.
   */
  readonly open: (host: ScopedThreadRef, threadId: ThreadId) => void;
  readonly place: (ref: ScopedThreadRef, dragged: ThreadId, zone: SplitDropZone) => void;
  readonly setMode: (ref: ScopedThreadRef, mode: SplitThreadMode) => void;
  readonly setRatio: (ref: ScopedThreadRef, ratio: number) => void;
  /** Ends the split `ref` is in; both threads stay. */
  readonly close: (ref: ScopedThreadRef) => void;
}

const updateLayout = (
  layouts: readonly SplitThreadLayout[],
  ref: ScopedThreadRef,
  update: (layout: SplitThreadLayout) => SplitThreadLayout,
) => {
  const index = layouts.findIndex((layout) => contains(layout, ref));
  if (index === -1) return layouts;
  const next = update(layouts[index]!);
  return next === layouts[index] ? layouts : layouts.with(index, next);
};

export const useSplitThreadStore = create<SplitThreadStoreState>()(
  persist(
    (set) => ({
      layouts: [],
      open: (host, threadId) => {
        if (host.threadId === threadId) return;
        const partner = { environmentId: host.environmentId, threadId };
        set((state) => ({
          layouts: [
            {
              environmentId: host.environmentId,
              first: host.threadId,
              second: threadId,
              mode: "row" as const,
              ratio: 0.5,
            },
            ...state.layouts.filter(
              (layout) => !contains(layout, host) && !contains(layout, partner),
            ),
          ].slice(0, MAX_LAYOUTS),
        }));
      },
      place: (ref, dragged, zone) =>
        set((state) => ({
          layouts: updateLayout(state.layouts, ref, (layout) =>
            placeSplitThread(layout, dragged, zone),
          ),
        })),
      setMode: (ref, mode) =>
        set((state) => ({
          layouts: updateLayout(state.layouts, ref, (layout) =>
            layout.mode === mode ? layout : { ...layout, mode },
          ),
        })),
      setRatio: (ref, ratio) =>
        set((state) => ({
          layouts: updateLayout(state.layouts, ref, (layout) => {
            const next = clampSplitRatio(ratio);
            return layout.ratio === next ? layout : { ...layout, ratio: next };
          }),
        })),
      close: (ref) =>
        set((state) => {
          const layouts = state.layouts.filter((layout) => !contains(layout, ref));
          return layouts.length === state.layouts.length ? state : { layouts };
        }),
    }),
    {
      name: "t3code:split-thread:v2",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ layouts: state.layouts }),
    },
  ),
);

/** The thread being dragged to rearrange a split, and the zone it points at. */
export const useSplitDragStore = create<{
  readonly dragging: ThreadId | null;
  readonly zone: SplitDropZone | null;
}>()(() => ({ dragging: null, zone: null }));
