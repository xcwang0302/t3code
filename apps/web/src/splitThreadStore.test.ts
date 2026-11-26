import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  findSplitLayout,
  placeSplitThread,
  splitDropZoneAt,
  splitPartner,
  type SplitThreadLayout,
  useSplitThreadStore,
} from "./splitThreadStore";

const env = "env-1" as EnvironmentId;
const A = ThreadId.make("thread-A");
const B = ThreadId.make("thread-B");
const C = ThreadId.make("thread-C");
const refA = scopeThreadRef(env, A);
const refB = scopeThreadRef(env, B);

beforeEach(() => {
  useSplitThreadStore.setState({ layouts: [] });
});

describe("splitThreadStore", () => {
  it("brings either thread's partner along and closes the split from either side", () => {
    useSplitThreadStore.getState().open(refA, B);
    const layout = findSplitLayout(useSplitThreadStore.getState().layouts, refB);
    expect(layout).toMatchObject({ first: A, second: B, mode: "row", ratio: 0.5 });
    expect(splitPartner(layout!, B)).toBe(A);
    useSplitThreadStore.getState().close(refB);
    expect(useSplitThreadStore.getState().layouts).toEqual([]);
  });

  it("moves a thread out of its old split into the new one", () => {
    useSplitThreadStore.getState().open(refA, B);
    useSplitThreadStore.getState().open(scopeThreadRef(env, C), A);
    const { layouts } = useSplitThreadStore.getState();
    expect(layouts).toHaveLength(1);
    expect(findSplitLayout(layouts, refB)).toBeNull();
  });

  it("never splits a thread with itself", () => {
    useSplitThreadStore.getState().open(refA, A);
    expect(useSplitThreadStore.getState().layouts).toEqual([]);
  });
});

describe("placeSplitThread", () => {
  const layout: SplitThreadLayout = {
    environmentId: env,
    first: A,
    second: B,
    mode: "row",
    ratio: 0.3,
  };

  it("swaps sides and keeps each thread's width", () => {
    expect(placeSplitThread(layout, A, "right")).toMatchObject({ first: B, second: A, ratio: 0.7 });
  });

  it("stacks on top or bottom and merges into tabs in the middle", () => {
    expect(placeSplitThread(layout, B, "top")).toMatchObject({ first: B, mode: "column" });
    expect(placeSplitThread(layout, B, "center")).toMatchObject({ mode: "tabs", first: A });
  });
});

describe("splitDropZoneAt", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  it("picks the nearest edge within a quarter, else the middle", () => {
    expect(splitDropZoneAt(rect, 10, 50)).toBe("left");
    expect(splitDropZoneAt(rect, 50, 95)).toBe("bottom");
    expect(splitDropZoneAt(rect, 50, 50)).toBe("center");
  });
});
