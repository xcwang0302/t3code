import { ThreadFolderId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFolderUpdate, type FolderCustomizeDraft } from "./folderCustomize.logic";

const folderId = ThreadFolderId.make("folder-1");
const folder = {
  id: folderId,
  name: "Reviews",
  icon: { kind: "lucide", name: "eye", color: "blue" },
  workspaceRoot: "/code/web",
} as const;
const unchanged: FolderCustomizeDraft = {
  name: folder.name,
  icon: folder.icon,
  workspaceRoot: folder.workspaceRoot,
};

describe("buildFolderUpdate", () => {
  it.each([
    ["nothing changed", unchanged, null],
    ["blank name is ignored", { ...unchanged, name: "  " }, null],
    ["renamed", { ...unchanged, name: " PRs " }, { type: "folder.update", folderId, name: "PRs" }],
    ["icon removed", { ...unchanged, icon: null }, { type: "folder.update", folderId, icon: null }],
    ["directory padded only", { ...unchanged, workspaceRoot: " /code/web " }, null],
    [
      "directory changed",
      { ...unchanged, workspaceRoot: " /code/api " },
      { type: "folder.update", folderId, workspaceRoot: "/code/api" },
    ],
    [
      "directory cleared",
      { ...unchanged, workspaceRoot: "  " },
      { type: "folder.update", folderId, workspaceRoot: null },
    ],
  ] as const)("%s", (_label, draft, expected) => {
    expect(buildFolderUpdate(folder, draft)).toEqual(expected);
  });
});
