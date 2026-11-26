import type { BoardColumn } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { mutateBoard, newBoardCardId, readBoard } from "../../state/board";
import { readThreadShell } from "../../state/entities";
import type { ThreadContextDropRef } from "../chat/threadContextDrop.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Puts each dropped thread in the column: its card moves there, and a thread without a card gets
 * one. The column the user chose wins over where auto flow would start the card.
 */
export async function dropThreadsOnBoardColumn(
  refs: ReadonlyArray<ThreadContextDropRef>,
  column: BoardColumn,
  dueDate: string | null,
): Promise<void> {
  const failure = m(msg("Could not add the thread to the board"));
  let withoutBoard = false;
  for (const ref of refs) {
    const board = readBoard();
    if (!board.environmentIds.includes(ref.environmentId)) {
      withoutBoard = true;
      continue;
    }
    const existing = board.cards.find(
      (card) => card.environmentId === ref.environmentId && card.threadIds.includes(ref.threadId),
    );
    if (existing) {
      if (
        existing.archivedAt !== null &&
        !(await mutateBoard(
          ref.environmentId,
          { type: "card.restore", cardId: existing.id },
          failure,
        ))
      ) {
        continue;
      }
      if (existing.column !== column) {
        await mutateBoard(
          ref.environmentId,
          { type: "card.move", cardId: existing.id, column },
          failure,
        );
      }
      continue;
    }
    const shell = readThreadShell(ref);
    const cardId = newBoardCardId();
    const created = await mutateBoard(
      ref.environmentId,
      {
        type: "card.create",
        cardId,
        title: (ref.title ?? shell?.title ?? "").trim().slice(0, 200) || m(msg("Untitled card")),
        projectId: shell?.projectId ?? null,
        column,
        dueDate,
        threadIds: [ref.threadId],
      },
      failure,
    );
    // Creating a card with a running thread starts it in doing; the drop said otherwise.
    if (created)
      await mutateBoard(ref.environmentId, { type: "card.move", cardId, column }, failure);
  }
  if (withoutBoard) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: failure,
        description: m(msg("The thread's environment has no board.")),
      }),
    );
  }
}
