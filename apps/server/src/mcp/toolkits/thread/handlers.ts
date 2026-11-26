import {
  type CommandId,
  type ProjectIconOverride,
  type RuntimeRequestId,
  type ThreadFolderError,
  type ThreadFolderRule,
  ThreadFolderId,
  type ThreadFolderMutation,
  ThreadSideTaskId,
  ThreadId,
  BoardCardId,
  type OrchestrationV2ThreadProjection,
  type RunId,
  OrchestratorMcpFailure,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import { modelSelectionCommandType } from "@t3tools/shared/model";
import { topOfPinnedRunOrderKey } from "@t3tools/shared/pinOrderKey";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  dispatchFailure,
  newCommandId,
  readCaller,
  readThread,
  unavailable,
} from "../../threadAccess.ts";
import { providerOptionDescriptors, refuseAgentModePick } from "../../delegatedTaskModes.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import type * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMessageIntake from "../../../orchestration-v2/ThreadMessageIntake.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as ScheduledTasks from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadFolders from "../../../threadFolders/ThreadFolderService.ts";
import * as ThreadSideTasks from "../../../threadSideTasks/ThreadSideTaskService.ts";
import * as Board from "../../../board/BoardService.ts";
import { queuedRunsInDeliveryOrder } from "../../../orchestration-v2/QueuedRunOrder.ts";
import { ThreadToolkit } from "./tools.ts";

function queueEntry(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
  runId: RunId,
  limit: number,
) {
  const run = projection.runs.find((run) => run.id === runId && run.status === "queued");
  const message = projection.messages.find((message) => message.id === run?.userMessageId);
  if (run === undefined || message === undefined) return undefined;
  const characters = Array.from(message.text);
  return {
    queuedRunId: run.id,
    text: characters.slice(0, limit).join(""),
    truncated: characters.length > limit,
  };
}
const dispatch = Effect.fn("mcp.dispatchThreadCommand")(function* (
  threadId: ThreadId | undefined,
  command: (common: { commandId: CommandId; threadId: ThreadId }) => OrchestrationV2Command,
) {
  const { threads, projection } = yield* readThread(threadId);
  const result = yield* threads
    .dispatch(command({ commandId: yield* newCommandId(), threadId: projection.thread.id }))
    .pipe(Effect.mapError(dispatchFailure));
  return { sequence: result.sequence };
});

/**
 * Places an agent pin at the top of the Pinned section, as a client pin is placed.
 * Without a key the sidebar sorts the pin below every keyed pin. Ordering is
 * best effort: if the index cannot be read, the pin still lands, keyless.
 */
const topOfPinnedRunKey = Effect.fn("mcp.topOfPinnedRunKey")(function* (
  threads: Pick<ThreadManagement.ThreadManagementService["Service"], "listActiveShellIndex">,
) {
  const index = yield* threads.listActiveShellIndex().pipe(Effect.orElseSucceed(() => null));
  if (index === null) return undefined;
  const pinnedKeys = index.flatMap((entry) => (entry.pinnedAt == null ? [] : [entry.pinOrderKey]));
  return topOfPinnedRunOrderKey(pinnedKeys) ?? undefined;
});

const readQuestion = Effect.fn("mcp.readQuestion")(function* (input: {
  threadId?: ThreadId | undefined;
  requestId: RuntimeRequestId;
}) {
  const context = yield* readThread(input.threadId, ["runtimeRequests", "turnItems"]);
  const request = context.projection.runtimeRequests.find(
    (request) => request.id === input.requestId && request.kind === "user_input",
  );
  const item = context.projection.turnItems.find(
    (item) => item.type === "user_input_request" && item.requestId === input.requestId,
  );
  if (request === undefined || item?.type !== "user_input_request")
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The pending user-input request was not found.",
    });
  if (request.status !== "pending")
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message:
        request.status === "resolved"
          ? "The user-input request was already answered."
          : `The user-input request is no longer pending (${request.status}).`,
    });
  return { ...context, request, item };
});
/** A field the chosen action needs. `null` counts as given, as in `beforeRunId: null`. */
const required = <A>(value: A | undefined, name: string) =>
  value === undefined
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `This action needs \`${name}\`.`,
        }),
      )
    : Effect.succeed(value);
const folderFailure = (error: ThreadFolderError) =>
  error.cause === undefined
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
    : unavailable();

const listFolders = Effect.fn("mcp.listThreadFolders")(function* () {
  yield* readCaller();
  const folders = yield* ThreadFolders.ThreadFolderService;
  return yield* folders.list().pipe(Effect.mapError(unavailable));
});

const writeFolders = Effect.fn("mcp.writeThreadFolders")(function* (input: {
  readonly action: "create" | "update" | "delete" | "move" | "reorder" | "apply_rule";
  readonly beforeFolderId?: ThreadFolderId | null | undefined;
  readonly rule?: ThreadFolderRule | null | undefined;
  readonly autoFile?: boolean | undefined;
  readonly folderId?: ThreadFolderId | null | undefined;
  readonly name?: string | undefined;
  readonly icon?: ProjectIconOverride | null | undefined;
  readonly threadIds?: ReadonlyArray<ThreadId> | undefined;
  readonly inferRules?: boolean;
}) {
  const { caller } = yield* readCaller();
  const folders = yield* ThreadFolders.ThreadFolderService;
  const folderId = () => required(input.folderId ?? undefined, "folderId");
  let mutation: ThreadFolderMutation;
  switch (input.action) {
    case "create": {
      const crypto = yield* SecureRandom.SecureRandom;
      mutation = {
        type: "folder.create",
        folderId: ThreadFolderId.make(`folder:${yield* crypto.uuidV4().pipe(Effect.orDie)}`),
        name: yield* required(input.name, "name"),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.rule === undefined ? {} : { rule: input.rule }),
        ...(input.autoFile === undefined ? {} : { autoFile: input.autoFile }),
        ...(input.threadIds === undefined || input.threadIds.length === 0
          ? {}
          : { threadIds: input.threadIds }),
      };
      break;
    }
    case "update":
      if (
        input.name === undefined &&
        input.icon === undefined &&
        input.rule === undefined &&
        input.autoFile === undefined
      ) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "update needs `name`, `icon`, `rule`, or `autoFile`.",
        });
      }
      mutation = {
        type: "folder.update",
        folderId: yield* folderId(),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.rule === undefined ? {} : { rule: input.rule }),
        ...(input.autoFile === undefined ? {} : { autoFile: input.autoFile }),
      };
      break;
    case "reorder":
      mutation = {
        type: "folder.reorder",
        folderId: yield* folderId(),
        beforeFolderId: yield* required(input.beforeFolderId, "beforeFolderId"),
      };
      break;
    case "apply_rule":
      mutation = { type: "folder.applyRule", folderId: yield* folderId() };
      break;
    case "delete":
      mutation = { type: "folder.delete", folderId: yield* folderId() };
      break;
    case "move": {
      const threadIds =
        input.threadIds === undefined || input.threadIds.length === 0
          ? caller === undefined
            ? undefined
            : [caller.id]
          : input.threadIds;
      mutation = {
        type: "folder.move",
        threadIds: yield* required(threadIds, "threadIds"),
        folderId: yield* required(input.folderId, "folderId"),
      };
      break;
    }
  }
  const result = yield* folders
    .mutate(mutation, { inferRules: input.inferRules ?? true })
    .pipe(Effect.mapError(folderFailure));
  return mutation.type === "folder.create"
    ? { folderId: mutation.folderId, folders: result.folders }
    : { folders: result.folders };
});

const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
  handle: (params: P) => Effect.Effect<A, E, R>,
) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

export const layer = McpToolAccess.toLayer(ThreadToolkit, {
  run_scheduled_task_now: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const scheduler = yield* ScheduledTasks.ScheduledTaskService;
      const { tasks } = yield* scheduler.list().pipe(Effect.mapError(unavailable));
      if (!tasks.some((task) => task.id === input.taskId))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The scheduled task was not found.",
        });
      const { task, threadId } = yield* scheduler
        .runNow({ id: input.taskId })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return {
        taskId: task.id,
        threadId,
        ...(threadId === null
          ? {}
          : {
              link: McpInvocationContext.threadLinkFor(scope, threadId),
            }),
        lastRunStatus: task.lastRunStatus,
        lastRunError: task.lastRunError,
        runCount: task.runCount,
        nextRunAt: task.nextRunAt,
      };
    }),
  ),
  t3_thread_search: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const threadSearch = yield* ThreadSearch.ThreadSearch;
      const { matches } = yield* threadSearch
        .searchThreads({ ...input, projectId: input.projectId ?? caller?.projectId })
        .pipe(Effect.mapError(unavailable));
      return {
        currentThreadId: scope.thread?.threadId ?? null,
        matches: matches.map((match) => ({
          ...match,
          link: McpInvocationContext.threadLinkFor(scope, match.threadId, match.title),
        })),
      };
    }),
  ),
  t3_thread_transfer: McpToolAccess.either(
    (input) => input.action === "status",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId, ["contextTransfers"]);
        return {
          transfers: projection.contextTransfers.map(
            ({ id, sourceThreadId, targetThreadId, status }) => ({
              id,
              sourceThreadId,
              targetThreadId,
              status,
            }),
          ),
        };
      }),
    ),
    McpToolAccess.writesThreads(
      (input) => [input.threadId, input.targetThreadId],
      (input) =>
        Effect.gen(function* () {
          const sourcePoint = input.sourcePoint ?? { type: "latest_stable" as const };
          const { threads, projection } = yield* readThread(input.threadId);
          const commandId = yield* newCommandId();
          if (input.action === "merge_back") {
            const targetThreadId = yield* required(input.targetThreadId, "targetThreadId");
            yield* readThread(targetThreadId);
            const result = yield* threads
              .dispatch({
                type: "thread.merge_back",
                commandId,
                sourceThreadId: projection.thread.id,
                targetThreadId,
                sourcePoint,
                createdBy: "agent",
                creationSource: "mcp",
              })
              .pipe(Effect.mapError(dispatchFailure));
            return { sequence: result.sequence, targetThreadId };
          }
          const targetThreadId = ThreadId.make(`${commandId}:fork`);
          const result = yield* threads
            .dispatch({
              type: "thread.fork",
              commandId,
              sourceThreadId: projection.thread.id,
              targetThreadId,
              sourcePoint,
              ...(input.title === undefined ? {} : { title: input.title }),
              createdBy: "agent",
              creationSource: "mcp",
            })
            .pipe(Effect.mapError(dispatchFailure));
          return { sequence: result.sequence, targetThreadId };
        }),
    ),
  ),
  t3_thread_configure: McpToolAccess.either(
    (input) => input.modelSelection === undefined,
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const {
          projection: { thread },
        } = yield* readThread(input.threadId);
        return {
          threadId: thread.id,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
        };
      }),
    ),
    writesThread((input) =>
      Effect.gen(function* () {
        const modelSelection = yield* required(input.modelSelection, "modelSelection");
        const {
          threads,
          projection: { thread },
        } = yield* readThread(input.threadId);
        const providers = yield* (yield* ProviderRegistry.ProviderRegistry).getProviders;
        yield* refuseAgentModePick({
          callerRuntimeMode: (yield* readCaller()).limits.runtimeMode,
          picked: modelSelection.options,
          descriptors: providerOptionDescriptors(
            providers.find((provider) => provider.instanceId === modelSelection.instanceId),
          ),
          held:
            thread.modelSelection.instanceId === modelSelection.instanceId
              ? thread.modelSelection.options
              : undefined,
        });
        const type = modelSelectionCommandType(thread.providerInstanceId, modelSelection);
        const result = yield* threads
          .dispatch({ type, threadId: thread.id, commandId: yield* newCommandId(), modelSelection })
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }),
    ),
  ),
  t3_pending_request: McpToolAccess.either(
    (input) => input.action !== "respond",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "list") {
          const { projection } = yield* readThread(input.threadId, ["runtimeRequests"]);
          return {
            requestIds: projection.runtimeRequests
              .filter((request) => request.kind === "user_input" && request.status === "pending")
              .map((request) => request.id),
          };
        }
        const requestId = yield* required(input.requestId, "requestId");
        const { item } = yield* readQuestion({ threadId: input.threadId, requestId });
        return { requestId, questions: item.questions };
      }),
    ),
    writesThread((input) =>
      Effect.gen(function* () {
        const requestId = yield* required(input.requestId, "requestId");
        const answers = yield* required(input.answers, "answers");
        const { threads, projection } = yield* readQuestion({
          threadId: input.threadId,
          requestId,
        });
        const result = yield* threads
          .dispatch({
            type: "runtime-request.respond",
            threadId: projection.thread.id,
            commandId: yield* newCommandId(),
            requestId,
            answers,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }),
    ),
  ),
  t3_submit_output: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, threads } = yield* readCaller();
      if (scope.thread === undefined) return yield* unavailable();
      return yield* threads
        .submitRunOutput({
          threadId: scope.thread.threadId,
          commandId: yield* newCommandId(),
          json: input.json,
        })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "ThreadManagementRunOutputRejectedError"
              ? new OrchestratorMcpFailure({
                  code: "invalid_request",
                  // The agent wrote the value, so it is told what in it did not fit.
                  message:
                    error.cause instanceof Error
                      ? `${error.message}\n${error.cause.message.slice(0, 2000)}`
                      : error.message,
                })
              : unavailable(),
          ),
        );
    }),
  ),
  t3_queue: McpToolAccess.either(
    (input) => input.action === "list" || input.action === "read",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { threads, projection: queued } = yield* readThread(input.threadId, ["runs"], {
          runStatuses: ["queued"],
        });
        const messages = yield* threads
          .getMessagesById(
            queued.thread.id,
            queued.runs.map((run) => run.userMessageId),
          )
          .pipe(Effect.mapError(unavailable));
        const projection = { runs: queued.runs, messages: [...messages.values()] };
        if (input.action === "list") {
          const runs = queuedRunsInDeliveryOrder(projection);
          const cursor = input.cursor ?? 0;
          const end = cursor + (input.limit ?? 20);
          return {
            items: runs.slice(cursor, end).flatMap((run) => {
              const entry = queueEntry(projection, run.id, 1000);
              return entry === undefined ? [] : [entry];
            }),
            nextCursor: end < runs.length ? end : null,
          };
        }
        const queuedRunId = yield* required(input.queuedRunId, "queuedRunId");
        return (
          queueEntry(projection, queuedRunId, 16000) ??
          (yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "The queued message was not found.",
          }))
        );
      }),
    ),
    writesThread((input) =>
      Effect.gen(function* () {
        const runId = yield* required(input.queuedRunId, "queuedRunId");
        switch (input.action) {
          case "edit": {
            const text = yield* required(input.text, "text");
            const { threads, projection } = yield* readThread(input.threadId);
            // An agent must not turn a person's queued message into a provider sign-out.
            const command = yield* ThreadMessageIntake.withQueuedAttachmentsOnSignOutText({
              type: "queued-run.edit",
              commandId: yield* newCommandId(),
              threadId: projection.thread.id,
              runId,
              text,
            }).pipe(
              Effect.mapError((error) =>
                error._tag === "EnvironmentAuthorizationError"
                  ? new OrchestratorMcpFailure({
                      code: "invalid_request",
                      message: "A queued message cannot be edited into a provider sign-out.",
                    })
                  : dispatchFailure(error),
              ),
            );
            const result = yield* threads.dispatch(command).pipe(Effect.mapError(dispatchFailure));
            return { sequence: result.sequence };
          }
          case "reorder": {
            const beforeRunId = yield* required(input.beforeRunId, "beforeRunId");
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-run.reorder",
              runId,
              beforeRunId,
            }));
          }
          case "promote_to_steer": {
            const targetRunId = yield* required(input.targetRunId, "targetRunId");
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-message.promote-to-steer",
              queuedRunId: runId,
              targetRunId,
            }));
          }
          default:
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-run.cancel",
              runId,
            }));
        }
      }),
    ),
  ),
  t3_thread_folder: McpToolAccess.either(
    (input) => input.action === "list",
    McpToolAccess.reads(() => listFolders()),
    McpToolAccess.either(
      // A rule reaches threads the caller never named, so only rule-free creates are thread writes.
      (input) => input.action === "move" || (input.action === "create" && input.rule == null),
      McpToolAccess.writesThreads(
        (input) => input.threadIds ?? [undefined],
        // A rule a folder's name implies still reaches unnamed threads, so these writes infer none.
        (input) =>
          writeFolders({
            ...input,
            action: input.action === "move" ? "move" : "create",
            inferRules: false,
          }),
      ),
      McpToolAccess.writes(
        (input) =>
          writeFolders({
            ...input,
            action:
              input.action === "create" ||
              input.action === "delete" ||
              input.action === "reorder" ||
              input.action === "apply_rule"
                ? input.action
                : "update",
          }),
        { refusal: "change this environment's sidebar folders" },
      ),
    ),
  ),
  // The task belongs to the calling thread, so it is a write to that thread alone.
  suggest_task: McpToolAccess.writesThreads(
    () => [undefined],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        if (scope.thread === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "suggest_task works inside a thread: it offers the task to that thread's user.",
          });
        }
        const sideTasks = yield* ThreadSideTasks.ThreadSideTaskService;
        const random = yield* SecureRandom.SecureRandom;
        const { task, pending } = yield* sideTasks
          .suggest({
            taskId: ThreadSideTaskId.make(`side-task:${yield* random.uuidV4()}`),
            threadId: scope.thread.threadId,
            title: input.title,
            prompt: input.prompt,
            reason: input.reason ?? null,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
            ),
          );
        return { taskId: task.id, pending };
      }),
  ),
  // The card is the user's; the thread is only its source, so it writes the calling thread alone.
  board_add_card: McpToolAccess.writesThreads(
    () => [undefined],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        if (scope.thread === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "board_add_card works inside a thread: the card goes in that thread's project.",
          });
        }
        const { projection } = yield* readThread(scope.thread.threadId);
        const board = yield* Board.BoardService;
        const random = yield* SecureRandom.SecureRandom;
        const cardId = BoardCardId.make(`card:${yield* random.uuidV4()}`);
        const boardFailure = (error: { readonly message: string }) =>
          new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
        // The thread's first card links it by default; later ones leave it on that first card.
        const attach =
          input.attach ??
          (yield* board
            .cardForThread(scope.thread.threadId)
            .pipe(Effect.mapError(boardFailure))) === null;
        yield* board
          .mutate({
            type: "card.create",
            cardId,
            title: input.title,
            ...(input.details === undefined ? {} : { details: input.details }),
            ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
            ...(input.column === undefined ? {} : { column: input.column }),
            projectId: projection.thread.projectId,
            ...(attach ? { threadIds: [scope.thread.threadId] } : {}),
          })
          .pipe(Effect.mapError(boardFailure));
        return { cardId, attached: attach };
      }),
  ),
  t3_thread_organize: writesThread((input) =>
    Effect.gen(function* () {
      const { threads, projection, caller } = yield* readThread(input.threadId);
      const common = { commandId: yield* newCommandId(), threadId: projection.thread.id };
      if (input.action === "settle") {
        return yield* threads
          .settleThread({ ...common, byOwnAgent: caller?.id === projection.thread.id })
          .pipe(Effect.mapError(dispatchFailure));
      }
      let command: OrchestrationV2Command;
      switch (input.action) {
        case "snooze":
          if (input.snoozedUntil === undefined) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "snooze requires snoozedUntil.",
            });
          }
          command = { ...common, type: "thread.snooze", snoozedUntil: input.snoozedUntil };
          break;
        case "unsnooze":
        case "unsettle":
          command = { ...common, type: `thread.${input.action}`, reason: "user" };
          break;
        case "mark_unread":
          command = { ...common, type: "thread.mark-unread" };
          break;
        case "pin": {
          // Always send a key, as the client does: the reducer ignores it for a
          // thread that is already pinned, and a projection read before this
          // command can be stale if an unpin commits in between.
          const orderKey = yield* topOfPinnedRunKey(threads);
          command = { ...common, type: "thread.pin", ...(orderKey ? { orderKey } : {}) };
          break;
        }
        default:
          command = { ...common, type: `thread.${input.action}` };
      }
      const result = yield* threads.dispatch(command).pipe(Effect.mapError(dispatchFailure));
      return { sequence: result.sequence };
    }),
  ),
});
