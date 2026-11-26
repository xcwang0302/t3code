import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { BoardColumn, BoardMutation, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskEdits";
import { useGT, useMessages } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { displayThreadTitle } from "../../lib/threadTitle";
import { cn } from "../../lib/utils";
import { type EnvironmentBoardCard, mutateBoard } from "../../state/board";
import { useThreadShells } from "../../state/entities";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { BOARD_COLUMN_ORDER, cardPrompt, checklistProgress } from "./board.logic";
import { ProjectDot } from "./BoardCardItem";
import { BoardThreadRow } from "./BoardThreadRow";
import { useBoardColumnLabels } from "./useBoardColumnLabels";

const MAX_LINKABLE_THREADS = 20;

/** Everything about one card, editable in place; it fills the board view while open. */
export function BoardCardDetail({
  card,
  projects,
  onClose,
  onOpenThread,
  closeLabel,
}: {
  readonly card: EnvironmentBoardCard;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly onClose: () => void;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
  readonly closeLabel: "back" | "close";
}) {
  const gt = useGT();
  const messages = useMessages();
  const columnLabels = useBoardColumnLabels();
  const handleNewThread = useNewThreadHandler();
  const shells = useThreadShells();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<string | null>(null);
  // A saved edit shows at once; the card catches up when the server echoes it.
  const [pendingDetails, setPendingDetails] = useState<{
    readonly value: string;
    readonly base: string;
  } | null>(null);
  const details =
    pendingDetails !== null && pendingDetails.base === card.updatedAt
      ? pendingDetails.value
      : card.details;
  const failure = gt("Could not update the card");
  const mutate = (mutation: BoardMutation) => mutateBoard(card.environmentId, mutation, failure);
  const update = (
    fields: Omit<Extract<BoardMutation, { type: "card.update" }>, "type" | "cardId">,
  ) => mutate({ type: "card.update", cardId: card.id, ...fields });

  const environmentProjects = projects.filter(
    (project) => project.environmentId === card.environmentId && !project.archivedAt,
  );
  const project = environmentProjects.find((entry) => entry.id === card.projectId) ?? null;
  const progress = checklistProgress(details);

  const saveTitle = () => {
    if (titleDraft === null) return;
    const next = titleDraft.trim().slice(0, 200);
    setTitleDraft(null);
    if (next.length > 0 && next !== card.title) void update({ title: next });
  };
  const saveDetails = () => {
    if (detailsDraft === null) return;
    const next = detailsDraft.slice(0, 50_000);
    setDetailsDraft(null);
    if (next === details) return;
    setPendingDetails({ value: next, base: card.updatedAt });
    void update({ details: next });
  };

  const handToAgent = async (projectId: ProjectId) => {
    if (card.projectId !== projectId) await update({ projectId });
    const opened = await handleNewThread(scopeProjectRef(card.environmentId, projectId), {
      prompt: cardPrompt(card),
    }).catch(() => null);
    if (opened === null) return;
    // The draft already owns its thread id, so the card follows the thread from its first send.
    await mutate({ type: "card.attachThread", cardId: card.id, threadId: opened.threadId });
  };

  const linkable = shells
    .filter(
      (shell) =>
        shell.environmentId === card.environmentId &&
        shell.archivedAt === null &&
        !card.threadIds.includes(shell.id),
    )
    .toSorted((a, b) => {
      // The card's own project first, then the most recent.
      const ownA = a.projectId === card.projectId ? 0 : 1;
      const ownB = b.projectId === card.projectId ? 0 : 1;
      return ownA - ownB || b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, MAX_LINKABLE_THREADS);

  const archive = async () => {
    await mutate({ type: "card.archive", cardId: card.id });
    onClose();
  };
  const deleteForever = async () => {
    const confirmed = await requestConfirmDialog(
      gt("Delete “{title}” for good? This cannot be undone.", { title: card.title }),
      { variant: "destructive" },
    );
    if (confirmed !== true) return;
    if (await mutate({ type: "card.delete", cardId: card.id })) onClose();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={closeLabel === "back" ? gt("Back to board") : gt("Close card")}
          onClick={onClose}
        >
          {closeLabel === "back" ? <ArrowLeftIcon /> : <XIcon />}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {card.archivedAt !== null ? gt("Archived card") : columnLabels[card.column]}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-pressed={card.pinned}
          aria-label={card.pinned ? gt("Unpin card") : gt("Pin card")}
          onClick={() => void update({ pinned: !card.pinned })}
        >
          {card.pinned ? <PinOffIcon /> : <PinIcon />}
        </Button>
        <Menu>
          <MenuTrigger
            render={<Button size="icon-sm" variant="ghost" aria-label={gt("More card actions")} />}
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {card.archivedAt === null ? (
              <MenuItem onClick={() => void archive()}>
                <ArchiveIcon />
                {gt("Archive card")}
              </MenuItem>
            ) : (
              <>
                <MenuItem onClick={() => void mutate({ type: "card.restore", cardId: card.id })}>
                  <ArchiveRestoreIcon />
                  {gt("Restore card")}
                </MenuItem>
                <MenuItem variant="destructive" onClick={() => void deleteForever()}>
                  <Trash2Icon />
                  {gt("Delete for good")}
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <textarea
          aria-label={gt("Card title")}
          rows={1}
          value={titleDraft ?? card.title}
          onChange={(event) => setTitleDraft(event.target.value.replace(/\n/g, " "))}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") setTitleDraft(null);
          }}
          className="field-sizing-content w-full resize-none bg-transparent text-base leading-6 font-semibold text-foreground outline-none"
        />

        <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">{gt("Column")}</span>
          <Menu>
            <MenuTrigger
              render={<Button size="xs" variant="outline" className="justify-self-start" />}
            >
              {columnLabels[card.column]}
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={card.column}
                onValueChange={(next) =>
                  void mutate({ type: "card.move", cardId: card.id, column: next as BoardColumn })
                }
              >
                {BOARD_COLUMN_ORDER.map((column) => (
                  <MenuRadioItem key={column} value={column}>
                    {columnLabels[column]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>

          <span className="text-muted-foreground">{gt("Due")}</span>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              size="sm"
              aria-label={gt("Due date")}
              value={card.dueDate ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                void update({ dueDate: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null });
              }}
              className="w-40"
            />
            {card.dueDate !== null ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Clear due date")}
                onClick={() => void update({ dueDate: null })}
              >
                <XIcon />
              </Button>
            ) : null}
          </div>

          <span className="text-muted-foreground">{gt("Project")}</span>
          <Menu>
            <MenuTrigger
              render={<Button size="xs" variant="outline" className="justify-self-start" />}
            >
              <ProjectDot name={project?.title ?? null} />
              <span className="truncate">{project?.title ?? gt("No project")}</span>
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={card.projectId ?? ""}
                onValueChange={(next) =>
                  void update({ projectId: next === "" ? null : (next as ProjectId) })
                }
              >
                <MenuRadioItem value="">{gt("No project")}</MenuRadioItem>
                {environmentProjects.map((entry) => (
                  <MenuRadioItem key={entry.id} value={entry.id}>
                    {entry.title}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        </div>

        <section className="mt-4" aria-labelledby="board-card-details-heading">
          <div className="mb-1 flex items-center gap-2">
            <h3
              id="board-card-details-heading"
              className="text-xs font-medium text-muted-foreground"
            >
              {gt("Details")}
            </h3>
            {progress !== null ? (
              <span className="text-2xs text-muted-foreground tabular-nums">
                {progress.done}/{progress.total}
              </span>
            ) : null}
            <span className="flex-1" />
            {detailsDraft === null ? (
              <Button size="xs" variant="ghost" onClick={() => setDetailsDraft(details)}>
                <PencilIcon />
                {gt("Edit")}
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                // Keeps focus in the editor, so its blur does not save first and swap this button.
                onMouseDown={(event) => event.preventDefault()}
                onClick={saveDetails}
              >
                <CheckIcon />
                {gt("Done")}
              </Button>
            )}
          </div>
          {detailsDraft !== null ? (
            <Textarea
              autoFocus
              aria-label={gt("Card details")}
              rows={8}
              value={detailsDraft}
              placeholder={gt("Write anything. Markdown works; - [ ] makes a checklist.")}
              onChange={(event) => setDetailsDraft(event.target.value)}
              onBlur={saveDetails}
              onKeyDown={(event) => {
                if (event.key === "Escape") setDetailsDraft(null);
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveDetails();
              }}
            />
          ) : details.trim().length === 0 ? (
            <button
              type="button"
              onClick={() => setDetailsDraft("")}
              className="w-full cursor-pointer rounded-md border border-dashed border-border px-3 py-3 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {gt("Add details…")}
            </button>
          ) : (
            <div className="text-sm">
              <ChatMarkdown
                text={details}
                cwd={undefined}
                lineBreaks
                onTaskListChange={({ markerOffset, checked }) => {
                  const next = setMarkdownTaskChecked(details, markerOffset, checked);
                  if (next === details) return;
                  setPendingDetails({ value: next, base: card.updatedAt });
                  void update({ details: next });
                }}
              />
            </div>
          )}
        </section>

        <section className="mt-5" aria-labelledby="board-card-threads-heading">
          <h3
            id="board-card-threads-heading"
            className="mb-1.5 text-xs font-medium text-muted-foreground"
          >
            {gt("Threads")}
          </h3>
          {card.threadIds.length === 0 ? (
            <p className="mb-2 text-xs text-muted-foreground">
              {gt("No thread yet. Hand it to an agent, or link a thread you already have.")}
            </p>
          ) : (
            <div className="mb-2 flex flex-col gap-1 rounded-md border border-border px-2 py-1.5">
              {card.threadIds.map((threadId) => (
                <BoardThreadRow
                  key={threadId}
                  environmentId={card.environmentId}
                  threadId={threadId}
                  onOpen={() => onOpenThread(scopeThreadRef(card.environmentId, threadId))}
                  removeLabel={gt("Unlink thread")}
                  onRemove={() =>
                    void mutate({ type: "card.detachThread", cardId: card.id, threadId })
                  }
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {card.projectId !== null && project !== null ? (
              <Button size="xs" onClick={() => void handToAgent(project.id)}>
                <BotIcon />
                {gt("Hand to an agent")}
              </Button>
            ) : (
              <Menu>
                <MenuTrigger
                  render={<Button size="xs" disabled={environmentProjects.length === 0} />}
                >
                  <BotIcon />
                  {gt("Hand to an agent")}
                </MenuTrigger>
                <MenuPopup align="start">
                  <MenuGroup>
                    <MenuGroupLabel>{gt("Start in project")}</MenuGroupLabel>
                    {environmentProjects.map((entry) => (
                      <MenuItem key={entry.id} onClick={() => void handToAgent(entry.id)}>
                        <ProjectDot name={entry.title} />
                        {entry.title}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                </MenuPopup>
              </Menu>
            )}
            <Menu>
              <MenuTrigger
                render={<Button size="xs" variant="outline" disabled={linkable.length === 0} />}
              >
                <LinkIcon />
                {gt("Link a thread")}
              </MenuTrigger>
              <MenuPopup align="start" className="max-w-80">
                {linkable.map((shell, index) => (
                  <div key={shell.id}>
                    {index > 0 &&
                    shell.projectId !== card.projectId &&
                    linkable[index - 1]?.projectId === card.projectId ? (
                      <MenuSeparator />
                    ) : null}
                    <MenuItem
                      onClick={() =>
                        void mutate({
                          type: "card.attachThread",
                          cardId: card.id,
                          threadId: shell.id,
                        })
                      }
                    >
                      <span className="truncate">{displayThreadTitle(shell.title, messages)}</span>
                    </MenuItem>
                  </div>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        </section>

        <p className={cn("mt-6 text-2xs text-muted-foreground")}>
          {gt("Created {date}", { date: new Date(card.createdAt).toLocaleString() })}
          {card.completedAt !== null
            ? ` · ${gt("Done {date}", { date: new Date(card.completedAt).toLocaleString() })}`
            : ""}
        </p>
      </div>
    </div>
  );
}
