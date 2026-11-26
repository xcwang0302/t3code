import { mapAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import { useRouter } from "@tanstack/react-router";
import { msg } from "gt-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { m } from "../i18n/messages";
import { releaseProjectDraftUploads } from "../lib/composerDraftUploads";
import { readLocalApi } from "../localApi";
import type { SidebarProjectGroupMember, SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { readThreadShells, waitForProjectRemoval } from "../state/entities";
import { readUnloadedThreadCount } from "../state/olderSettledShelf";
import { projectEnvironment } from "../state/projects";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { checkProjectAccess, reportProjectFailure } from "./useProjectGroupUpdate";

export interface RemoveProjectMembersInput {
  /** The project group shown to the user; its name labels the confirmation. */
  readonly group: Pick<SidebarProjectSnapshot, "displayName" | "memberProjects">;
  /** The checkouts to remove: the whole group, or one machine's entries. */
  readonly members: ReadonlyArray<SidebarProjectGroupMember>;
  /** Every checkout of the project, so a surviving one can inherit the project draft. */
  readonly allMembers: ReadonlyArray<SidebarProjectGroupMember>;
  /** Whether checkouts outside `group` stay behind (a machine-scoped view). */
  readonly hasOtherMembers: boolean;
}

/**
 * Confirms, then removes project entries and their threads, one checkout at a time.
 * Files on disk are not touched. Resolves true only when every member was removed.
 */
export function useRemoveProjectMembers() {
  const router = useRouter();
  const deleteProject = useOrchestrationCommand(projectEnvironment.delete, {
    reportFailure: false,
  });

  return async ({
    group,
    members,
    allMembers,
    hasOtherMembers,
  }: RemoveProjectMembersInput): Promise<boolean> => {
    const failureTitle = m(msg("Failed to remove project"));
    if (members.length === 0) return false;
    if (checkProjectAccess(members, failureTitle)) return false;
    const api = readLocalApi();
    if (!api) return false;

    const threads = readThreadShells();
    const { projectThreads, confirmationMessage } = planProjectRemoval(
      {
        members,
        groupMemberCount: group.memberProjects.length,
        hasOtherMembers,
        displayName: group.displayName,
        threads,
        unloadedThreadCount: readUnloadedThreadCount(members, threads),
      },
      m,
    );
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(confirmationMessage, { variant: "destructive" }),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return false;
    if (checkProjectAccess(members, failureTitle)) return false;

    const draftStore = useComposerDraftStore.getState();
    const isMember = (environmentId: string, projectId: string) =>
      members.some((member) => member.environmentId === environmentId && member.id === projectId);
    // Capture what the route shows now; the thread or draft is gone once removal lands.
    const routeParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    const routeTarget = resolveThreadRouteTarget(routeParams);
    const removedThreadKeys = new Set(
      projectThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    );
    const viewingRemovedThread =
      routeTarget?.kind === "server" &&
      removedThreadKeys.has(scopedThreadKey(routeTarget.threadRef));
    const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
    const routeDraftBefore = routeDraftId ? draftStore.getDraftSession(routeDraftId) : null;
    const viewingRemovedProjectDraft =
      routeDraftBefore != null &&
      isMember(routeDraftBefore.environmentId, routeDraftBefore.projectId);

    const remainingMember = allMembers.find(
      (candidate) => !isMember(candidate.environmentId, candidate.id),
    );
    for (const member of members) {
      // Access can be revoked between deletes.
      if (checkProjectAccess([member], failureTitle)) return false;
      const memberThreads = projectThreads.filter(
        (thread) => thread.environmentId === member.environmentId && thread.projectId === member.id,
      );
      const result = mapAtomCommandResult(
        await deleteProject({
          environmentId: member.environmentId,
          input: { projectId: member.id, force: true },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportProjectFailure(m(msg('Failed to remove "{title}"', { title: member.title })), result);
        return false;
      }
      const projectRef = scopeProjectRef(member.environmentId, member.id);
      await waitForProjectRemoval(projectRef);
      releaseProjectDraftUploads(
        projectRef,
        memberThreads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
      );
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
      if (projectDraftThread && remainingMember) {
        draftStore.setDraftThreadContext(projectDraftThread.draftId, {
          projectRef: scopeProjectRef(remainingMember.environmentId, remainingMember.id),
          environmentSelection: "manual",
          loadBalancedEnvironmentId: null,
        });
      } else if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(projectRef);
    }

    // A draft moved to a surviving checkout stays open; one that was cleared or still points
    // at a removed project has nothing left to show.
    const routeDraftAfter =
      viewingRemovedProjectDraft && routeDraftId
        ? useComposerDraftStore.getState().getDraftSession(routeDraftId)
        : null;
    const viewingRemovedDraft =
      viewingRemovedProjectDraft &&
      (routeDraftAfter == null ||
        isMember(routeDraftAfter.environmentId, routeDraftAfter.projectId));
    if (viewingRemovedThread || viewingRemovedDraft) {
      void router.navigate({ to: "/", replace: true });
    }
    return true;
  };
}
