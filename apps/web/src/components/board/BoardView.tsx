import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { BoardColumn, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import {
  type EnvironmentBoardCard,
  mutateBoard,
  newBoardCardId,
  useBoard,
} from "../../state/board";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useAllSideTasks } from "../../state/threadSideTasks";
import { THREAD_CONTEXT_DROP_EVENT, threadContextDropTargetProps } from "../chat/threadContextDrag";
import type { ThreadContextDropRef } from "../chat/threadContextDrop.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  BOARD_COLUMN_ORDER,
  columnOrderAfterDrop,
  dayKey,
  dueState,
  isRecentlyDone,
  orderColumn,
} from "./board.logic";
import { BoardCalendar } from "./BoardCalendar";
import { BoardCardDetail } from "./BoardCardDetail";
import { BoardCardItem, ProjectDot } from "./BoardCardItem";
import { BoardSuggestions } from "./BoardSuggestions";
import { dropThreadsOnBoardColumn } from "./boardThreadDrop";
import { cardKeyString, sameCardKey, useBoardUiStore } from "./boardUiStore";
import { BOARD_COLUMN_DOT, useBoardColumnLabels } from "./useBoardColumnLabels";

const projectKey = (environmentId: string, projectId: string) => `${environmentId}:${projectId}`;

function DraggableCard({
  card,
  children,
}: {
  readonly card: EnvironmentBoardCard;
  readonly children: ReactNode;
}) {
  const key = cardKeyString({ environmentId: card.environmentId, cardId: card.id });
  const drag = useDraggable({ id: `drag|${key}` });
  const drop = useDroppable({ id: `card|${key}` });
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      {...drag.attributes}
      {...drag.listeners}
      // The card itself is the button; the drag handle needs no role of its own.
      role={undefined}
      tabIndex={undefined}
      className={cn(
        "relative touch-none",
        drag.isDragging && "opacity-30",
        drop.isOver &&
          !drag.isDragging &&
          "before:absolute before:inset-x-1 before:-top-1 before:h-0.5 before:rounded-full before:bg-primary",
      )}
    >
      {children}
    </div>
  );
}

function ColumnDropArea({
  column,
  className,
  onDropThreads,
  children,
}: {
  readonly column: BoardColumn;
  readonly className?: string;
  /** Threads dragged out of the sidebar and let go over this column. */
  readonly onDropThreads: (refs: ReadonlyArray<ThreadContextDropRef>) => void;
  readonly children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column|${column}` });
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const handleDropThreads = useEffectEvent(onDropThreads);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the column element to thread drops, which arrive as DOM events from the sidebar's drag
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const listener = (event: Event) =>
      handleDropThreads((event as CustomEvent<ReadonlyArray<ThreadContextDropRef>>).detail);
    node.addEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
    return () => node.removeEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
  }, []);
  return (
    <div
      ref={(node) => {
        nodeRef.current = node;
        setNodeRef(node);
      }}
      data-board-column={column}
      {...threadContextDropTargetProps()}
      className={cn(
        className,
        "data-[thread-context-over]:ring-2 data-[thread-context-over]:ring-primary/40 data-[thread-context-over]:ring-inset",
        isOver && "ring-2 ring-primary/40 ring-inset",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The board: four columns of cards, with a calendar of due dates. The page lays the columns side
 * by side; the panel stacks them. Both read and write the same cards.
 */
export function BoardView({
  layout,
  onOpenThread,
}: {
  readonly layout: "page" | "panel";
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const board = useBoard();
  const projects = useProjects();
  const sideTasks = useAllSideTasks();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const columnLabels = useBoardColumnLabels();
  const nowMinute = useNowMinute();
  const now = new Date(nowMinute);
  const today = dayKey(now);
  const ui = useBoardUiStore();
  const [calendarOpen, setCalendarOpen] = useLocalStorage(
    "t3code:board:calendar-open",
    true,
    Schema.Boolean,
  );
  const [quickTitle, setQuickTitle] = useState("");
  const [activeDrag, setActiveDrag] = useState<EnvironmentBoardCard | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const projectsByKey = new Map<string, EnvironmentProject>(
    projects.map((project) => [projectKey(project.environmentId, project.id), project]),
  );
  const projectNameOf = (card: EnvironmentBoardCard) =>
    card.projectId === null
      ? null
      : (projectsByKey.get(projectKey(card.environmentId, card.projectId))?.title ?? null);

  const live = board.cards.filter((card) => card.archivedAt === null);
  const archived = board.cards.filter((card) => card.archivedAt !== null);
  const matchesProject = (card: EnvironmentBoardCard) =>
    ui.projectFilter === null ||
    (ui.projectFilter === "none"
      ? card.projectId === null
      : card.projectId !== null &&
        projectKey(card.environmentId, card.projectId) === ui.projectFilter);
  const inScope = live.filter(matchesProject);
  const visible = inScope.filter(
    (card) => ui.selectedDay === null || card.dueDate === ui.selectedDay,
  );
  const columns = new Map<BoardColumn, Array<EnvironmentBoardCard>>(
    BOARD_COLUMN_ORDER.map((column) => [
      column,
      orderColumn(visible.filter((card) => card.column === column)),
    ]),
  );
  const doneCards = columns.get("done") ?? [];
  const recentDone = doneCards.filter((card) => isRecentlyDone(card, now));
  const olderDoneCount = doneCards.length - recentDone.length;

  const filterChips = [
    ...new Map(
      live.flatMap((card) => {
        if (card.projectId === null) return [];
        const key = projectKey(card.environmentId, card.projectId);
        const project = projectsByKey.get(key);
        return project ? [[key, project] as const] : [];
      }),
    ).entries(),
  ];
  const hasUnfiled = live.some((card) => card.projectId === null);

  const takenSideTasks = new Set(
    board.cards.flatMap((card) => (card.sideTaskId === null ? [] : [card.sideTaskId])),
  );
  const suggestions = sideTasks.filter(
    (task) =>
      task.status === "pending" &&
      !takenSideTasks.has(task.id) &&
      board.environmentIds.includes(task.environmentId),
  );

  const overdueCount = inScope.filter((card) => dueState(card, today) === "overdue").length;
  const reviewCount = inScope.filter((card) => card.column === "review").length;
  const doingCount = inScope.filter((card) => card.column === "doing").length;

  const filteredProject =
    ui.projectFilter !== null && ui.projectFilter !== "none"
      ? (projectsByKey.get(ui.projectFilter) ?? null)
      : null;
  const createEnvironmentId =
    filteredProject?.environmentId ??
    (primaryEnvironmentId !== null && board.environmentIds.includes(primaryEnvironmentId)
      ? primaryEnvironmentId
      : (board.environmentIds[0] ?? null));

  const addCard = async () => {
    const title = quickTitle.trim().slice(0, 200);
    if (title.length === 0 || createEnvironmentId === null) return;
    setQuickTitle("");
    await mutateBoard(
      createEnvironmentId,
      {
        type: "card.create",
        cardId: newBoardCardId(),
        title,
        projectId: filteredProject?.id ?? null,
        dueDate: ui.selectedDay,
      },
      gt("Could not add the card"),
    );
  };

  const dropThreads = (refs: ReadonlyArray<ThreadContextDropRef>, column: BoardColumn) =>
    void dropThreadsOnBoardColumn(refs, column, ui.selectedDay);

  const cardByDragId = (id: string) => {
    const key = id.slice(id.indexOf("|") + 1);
    return board.cards.find(
      (card) => cardKeyString({ environmentId: card.environmentId, cardId: card.id }) === key,
    );
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveDrag(cardByDragId(String(event.active.id)) ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const card = cardByDragId(String(event.active.id));
    const over = event.over;
    if (!card || !over) return;
    const overId = String(over.id);
    const failure = gt("Could not move the card");
    if (overId.startsWith("day:")) {
      const day = overId.slice("day:".length);
      if (day !== card.dueDate) {
        void mutateBoard(
          card.environmentId,
          { type: "card.update", cardId: card.id, dueDate: day },
          failure,
        );
      }
      return;
    }
    let column: BoardColumn;
    let index: number;
    if (overId.startsWith("column|")) {
      column = overId.slice("column|".length) as BoardColumn;
      index = Number.POSITIVE_INFINITY;
    } else if (overId.startsWith("card|")) {
      const target = cardByDragId(overId);
      if (!target || target === card) return;
      column = target.column;
      const list = (columns.get(column) ?? []).filter(
        (entry) => entry.environmentId === card.environmentId,
      );
      const targetIndex = list.indexOf(target);
      const translated = event.active.rect.current.translated;
      const below =
        translated !== null &&
        translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2;
      index = targetIndex + (below ? 1 : 0);
      // Removing the card from above the target shifts the target up by one.
      const ownIndex = list.indexOf(card);
      if (ownIndex !== -1 && ownIndex < targetIndex) index -= 1;
    } else {
      return;
    }
    const sameEnvironment = (columns.get(column) ?? []).filter(
      (entry) => entry.environmentId === card.environmentId,
    );
    const orderedCardIds = columnOrderAfterDrop(sameEnvironment, card.id, index);
    void mutateBoard(
      card.environmentId,
      { type: "card.move", cardId: card.id, column, orderedCardIds },
      failure,
    );
  };

  const openCard = ui.openCard
    ? (board.cards.find((card) =>
        sameCardKey(ui.openCard, { environmentId: card.environmentId, cardId: card.id }),
      ) ?? null)
    : null;
  const openCardView = (card: EnvironmentBoardCard) =>
    ui.openCardDetail({ environmentId: card.environmentId, cardId: card.id });

  const detail = openCard ? (
    <BoardCardDetail
      key={cardKeyString({ environmentId: openCard.environmentId, cardId: openCard.id })}
      card={openCard}
      projects={projects}
      closeLabel={layout === "panel" ? "back" : "close"}
      onClose={() => ui.openCardDetail(null)}
      onOpenThread={onOpenThread}
    />
  ) : null;

  if (layout === "panel" && detail) {
    return <div className="flex h-full min-h-0 flex-col">{detail}</div>;
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip active={ui.projectFilter === null} onClick={() => ui.setProjectFilter(null)}>
        {gt("All", { $context: "board filter showing every project" })}
      </FilterChip>
      {filterChips.map(([key, project]) => (
        <FilterChip
          key={key}
          active={ui.projectFilter === key}
          onClick={() => ui.setProjectFilter(ui.projectFilter === key ? null : key)}
        >
          <ProjectDot name={project.title} />
          {project.title}
        </FilterChip>
      ))}
      {hasUnfiled ? (
        <FilterChip
          active={ui.projectFilter === "none"}
          onClick={() => ui.setProjectFilter(ui.projectFilter === "none" ? null : "none")}
        >
          {gt("No project")}
        </FilterChip>
      ) : null}
      <span className="flex-1" />
      <span className="flex items-center gap-2 text-2xs whitespace-nowrap tabular-nums">
        {overdueCount > 0 ? (
          <span className="text-destructive-foreground">
            {gt("Overdue {count}", { count: overdueCount })}
          </span>
        ) : null}
        <span className="text-warning-foreground">
          {gt("To review {count}", { count: reviewCount })}
        </span>
        <span className="text-info-foreground">
          {gt("In progress {count}", { count: doingCount })}
        </span>
      </span>
      <Button
        size="icon-xs"
        variant={calendarOpen ? "secondary" : "ghost"}
        aria-pressed={calendarOpen}
        aria-label={gt("Calendar")}
        onClick={() => setCalendarOpen(!calendarOpen)}
      >
        <CalendarDaysIcon />
      </Button>
      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost" aria-label={gt("Board options")} />}
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuCheckboxItem
            checked={board.autoFlow}
            onCheckedChange={(checked) => {
              for (const environmentId of board.environmentIds) {
                void mutateBoard(
                  environmentId,
                  { type: "board.setAutoFlow", enabled: checked },
                  gt("Could not update the board"),
                );
              }
            }}
          >
            {gt("Move cards with their threads")}
          </MenuCheckboxItem>
          <MenuItem onClick={() => ui.setShowArchive(!ui.showArchive)}>
            <ArchiveIcon />
            {ui.showArchive
              ? gt("Back to board")
              : gt("Archived cards ({count})", { count: archived.length })}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );

  const quickAdd = (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void addCard();
      }}
    >
      <PlusIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <Input
        size="sm"
        value={quickTitle}
        onChange={(event) => setQuickTitle(event.target.value)}
        placeholder={
          ui.selectedDay === null
            ? gt("Note something… (Enter to add)")
            : gt("Note something due {day}… (Enter to add)", { day: ui.selectedDay })
        }
        aria-label={gt("New card title")}
        disabled={createEnvironmentId === null}
      />
    </form>
  );

  const dayFilter =
    ui.selectedDay !== null ? (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">
          {gt("Due {day} · {count}", { day: ui.selectedDay, count: visible.length })}
        </span>
        <Button size="xs" variant="ghost" onClick={() => ui.selectDay(null)}>
          <XIcon />
          {gt("Clear", { $context: "clears the chosen calendar day" })}
        </Button>
      </div>
    ) : null;

  const calendar = calendarOpen ? (
    <BoardCalendar
      cards={inScope}
      today={today}
      selectedDay={ui.selectedDay}
      projectNameOf={projectNameOf}
      onSelectDay={ui.selectDay}
    />
  ) : null;

  const renderCards = (column: BoardColumn) => {
    const cards = column === "done" && !ui.showOlderDone ? recentDone : (columns.get(column) ?? []);
    return cards.map((card) => (
      <DraggableCard key={`${card.environmentId}|${card.id}`} card={card}>
        <BoardCardItem
          card={card}
          projectName={projectNameOf(card)}
          today={today}
          onOpen={() => openCardView(card)}
          onOpenThread={onOpenThread}
        />
      </DraggableCard>
    ));
  };

  const columnHeader = (column: BoardColumn) => (
    <div className="flex min-w-0 items-center gap-1.5 px-0.5 text-xs font-medium whitespace-nowrap">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", BOARD_COLUMN_DOT[column])} />
      {columnLabels[column]}
      <span className="truncate font-normal text-muted-foreground tabular-nums">
        {column === "done" && !ui.showOlderDone
          ? gt("last 7 days · {count}", { count: recentDone.length })
          : (columns.get(column) ?? []).length}
      </span>
    </div>
  );

  const olderDoneToggle =
    olderDoneCount > 0 || ui.showOlderDone ? (
      <button
        type="button"
        onClick={() => ui.setShowOlderDone(!ui.showOlderDone)}
        className="flex cursor-pointer items-center gap-1 px-1 text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
      >
        {ui.showOlderDone
          ? gt("Only the last 7 days")
          : gt("{count} older", { count: olderDoneCount })}
        <ChevronDownIcon className={cn("size-3", ui.showOlderDone && "rotate-180")} aria-hidden />
      </button>
    ) : null;

  const suggestionsBlock =
    ui.selectedDay === null && ui.projectFilter === null ? (
      <BoardSuggestions tasks={suggestions} onOpenThread={onOpenThread} />
    ) : null;

  const emptyHint = (column: BoardColumn) =>
    (columns.get(column) ?? []).length === 0 && !(column === "todo" && suggestions.length > 0) ? (
      <p className="px-1 py-2 text-2xs text-muted-foreground/70">{gt("Drop cards here")}</p>
    ) : null;

  const archiveView = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{gt("Archived cards")}</span>
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={() => ui.setShowArchive(false)}>
          {gt("Back to board")}
        </Button>
      </div>
      {archived.length === 0 ? (
        <p className="text-xs text-muted-foreground">{gt("Nothing archived.")}</p>
      ) : (
        archived.map((card) => (
          <div
            key={`${card.environmentId}|${card.id}`}
            className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
          >
            <button
              type="button"
              onClick={() => openCardView(card)}
              className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm outline-none hover:underline focus-visible:underline"
            >
              {card.title}
            </button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void mutateBoard(
                  card.environmentId,
                  { type: "card.restore", cardId: card.id },
                  gt("Could not restore the card"),
                )
              }
            >
              <ArchiveRestoreIcon />
              {gt("Restore")}
            </Button>
          </div>
        ))
      )}
    </div>
  );

  const loading = !board.loaded && board.environmentIds.length > 0;

  const columnsView =
    layout === "page" ? (
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[repeat(4,minmax(12rem,1fr))] gap-2 overflow-x-auto">
        {BOARD_COLUMN_ORDER.map((column) => (
          <ColumnDropArea
            key={column}
            column={column}
            className="flex min-h-0 min-w-0 flex-col gap-2 rounded-xl bg-muted/60 p-2"
            onDropThreads={(refs) => dropThreads(refs, column)}
          >
            {columnHeader(column)}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-4">
              {column === "todo" ? suggestionsBlock : null}
              {renderCards(column)}
              {column === "done" ? olderDoneToggle : null}
              {emptyHint(column)}
            </div>
          </ColumnDropArea>
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {BOARD_COLUMN_ORDER.map((column) => (
          <ColumnDropArea
            key={column}
            column={column}
            className="flex flex-col gap-1.5 rounded-lg"
            onDropThreads={(refs) => dropThreads(refs, column)}
          >
            {columnHeader(column)}
            {column === "todo" ? suggestionsBlock : null}
            {renderCards(column)}
            {column === "done" ? olderDoneToggle : null}
            {emptyHint(column)}
          </ColumnDropArea>
        ))}
      </div>
    );

  const body = ui.showArchive ? (
    archiveView
  ) : loading ? (
    <p className="text-xs text-muted-foreground">{gt("Loading the board…")}</p>
  ) : (
    columnsView
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      {layout === "page" ? (
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {toolbar}
            {quickAdd}
            {dayFilter}
            <div className="flex min-h-0 flex-1 gap-3">
              {calendar ? <div className="w-56 shrink-0">{calendar}</div> : null}
              {body}
            </div>
          </div>
          {detail ? (
            // Slides over the board from the right, so the columns keep their width.
            <div className="absolute inset-y-0 right-0 z-10 flex w-[min(26rem,100%)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
              {detail}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-3">
          {toolbar}
          {calendar}
          {quickAdd}
          {dayFilter}
          {body}
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div className="w-64 rotate-1">
            <BoardCardItem
              card={activeDrag}
              projectName={projectNameOf(activeDrag)}
              today={today}
              dragging
              onOpen={() => undefined}
              onOpenThread={() => undefined}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-6 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active && "bg-secondary text-foreground",
      )}
    >
      {children}
    </button>
  );
}
