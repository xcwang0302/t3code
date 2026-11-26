import { BoardCardId, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mutateBoard, readBoard } from "../../state/board";
import { toastManager } from "../ui/toast";
import { dropThreadsOnBoardColumn } from "./boardThreadDrop";

vi.mock("../../state/board", () => ({
  mutateBoard: vi.fn(async () => true),
  newBoardCardId: () => "card:new",
  readBoard: vi.fn(),
}));
vi.mock("../../state/entities", () => ({
  readThreadShell: vi.fn(() => ({ title: "  Fix login  ", projectId: "project:web" })),
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (toast: unknown) => toast,
}));

const local = EnvironmentId.make("local");
const threadId = ThreadId.make("thread:1");
const ref = { environmentId: local, threadId };

const boardWith = (cards: ReadonlyArray<Record<string, unknown>>) =>
  vi.mocked(readBoard).mockReturnValue({
    cards,
    environmentIds: [local],
    autoFlow: true,
    loaded: true,
  } as unknown as ReturnType<typeof readBoard>);

const mutations = () => vi.mocked(mutateBoard).mock.calls.map(([, mutation]) => mutation);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mutateBoard).mockResolvedValue(true);
});

describe("dropThreadsOnBoardColumn", () => {
  it("makes a card for a thread without one and keeps it in the dropped column", async () => {
    boardWith([]);
    await dropThreadsOnBoardColumn([ref], "todo", "2026-12-01");
    expect(mutations()).toEqual([
      {
        type: "card.create",
        cardId: "card:new",
        title: "Fix login",
        projectId: ProjectId.make("project:web"),
        column: "todo",
        dueDate: "2026-12-01",
        threadIds: [threadId],
      },
      { type: "card.move", cardId: "card:new", column: "todo" },
    ]);
  });

  it("moves the card a thread is already on", async () => {
    const cardId = BoardCardId.make("card:old");
    boardWith([
      {
        id: cardId,
        environmentId: local,
        threadIds: [threadId],
        column: "doing",
        archivedAt: null,
      },
    ]);
    await dropThreadsOnBoardColumn([ref], "review", null);
    expect(mutations()).toEqual([{ type: "card.move", cardId, column: "review" }]);

    vi.mocked(mutateBoard).mockClear();
    await dropThreadsOnBoardColumn([ref], "doing", null);
    expect(mutateBoard).not.toHaveBeenCalled();
  });

  it("restores an archived card before moving it", async () => {
    const cardId = BoardCardId.make("card:old");
    boardWith([
      { id: cardId, environmentId: local, threadIds: [threadId], column: "todo", archivedAt: "x" },
    ]);
    await dropThreadsOnBoardColumn([ref], "done", null);
    expect(mutations()).toEqual([
      { type: "card.restore", cardId },
      { type: "card.move", cardId, column: "done" },
    ]);
  });

  it("does not move a card that could not be created", async () => {
    boardWith([]);
    vi.mocked(mutateBoard).mockResolvedValue(false);
    await dropThreadsOnBoardColumn([ref], "todo", null);
    expect(mutateBoard).toHaveBeenCalledOnce();
  });

  it("says so when the thread's environment keeps no board", async () => {
    boardWith([]);
    await dropThreadsOnBoardColumn(
      [{ environmentId: EnvironmentId.make("remote"), threadId }],
      "todo",
      null,
    );
    expect(mutateBoard).not.toHaveBeenCalled();
    expect(toastManager.add).toHaveBeenCalledOnce();
  });
});
