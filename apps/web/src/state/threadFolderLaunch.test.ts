import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadFolderId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { readPendingThreadFolder, setPendingThreadFolder } from "./pendingThreadFolders";
import {
  filePendingThreadFolder,
  findThreadFolderProject,
  sameWorkspaceRoot,
} from "./threadFolderLaunch";
import { moveThreadsToFolder } from "./threadFolders";

vi.mock("./threadFolders", () => ({ moveThreadsToFolder: vi.fn(async () => null) }));
vi.mock("./entities", () => ({ readProjects: vi.fn(() => []) }));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (toast: unknown) => toast,
}));

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const folderId = ThreadFolderId.make("folder:web");
const threadId = ThreadId.make("thread:draft");

const project = (environmentId: EnvironmentId, id: string, workspaceRoot: string) =>
  ({ environmentId, id: ProjectId.make(id), workspaceRoot }) as EnvironmentProject;

beforeEach(() => {
  vi.clearAllMocks();
  setPendingThreadFolder(threadId, null);
});

describe("pending thread folders", () => {
  it("files a sent draft into the folder it was opened from, once", async () => {
    setPendingThreadFolder(threadId, { environmentId: local, folderId });
    await filePendingThreadFolder(local, threadId);
    expect(moveThreadsToFolder).toHaveBeenCalledWith({
      environmentId: local,
      threadIds: [threadId],
      folderId,
    });
    expect(readPendingThreadFolder(threadId)).toBeNull();

    await filePendingThreadFolder(local, threadId);
    expect(moveThreadsToFolder).toHaveBeenCalledOnce();
  });

  it("leaves a draft opened elsewhere unfiled", async () => {
    setPendingThreadFolder(threadId, { environmentId: local, folderId });
    setPendingThreadFolder(threadId, null);
    await filePendingThreadFolder(local, threadId);
    expect(moveThreadsToFolder).not.toHaveBeenCalled();
  });

  it("warns instead of filing a thread that started on another environment", async () => {
    setPendingThreadFolder(threadId, { environmentId: local, folderId });
    await filePendingThreadFolder(remote, threadId);
    expect(moveThreadsToFolder).not.toHaveBeenCalled();
    expect(toastManager.add).toHaveBeenCalledOnce();
    expect(readPendingThreadFolder(threadId)).toBeNull();
  });
});

describe("findThreadFolderProject", () => {
  const projects = [
    project(remote, "remote-web", "/code/web"),
    project(local, "local-api", "/code/api"),
    project(local, "local-web", "/code/web/"),
  ];

  it("finds the project for the folder's directory on the folder's environment", () => {
    expect(
      findThreadFolderProject({ environmentId: local, workspaceRoot: "/code/web" }, projects)?.id,
    ).toBe("local-web");
  });

  it("returns null without a directory or a matching project", () => {
    expect(findThreadFolderProject({ environmentId: local, workspaceRoot: null }, projects)).toBe(
      null,
    );
    expect(
      findThreadFolderProject({ environmentId: local, workspaceRoot: "/code/docs" }, projects),
    ).toBe(null);
  });

  it("ignores trailing separators but not other differences", () => {
    expect(sameWorkspaceRoot("/code/web/", "/code/web")).toBe(true);
    expect(sameWorkspaceRoot("/", "/")).toBe(true);
    expect(sameWorkspaceRoot("/code/web", "/code/website")).toBe(false);
  });
});
