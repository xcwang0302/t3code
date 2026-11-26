import type { EnvironmentThreadFolder } from "@t3tools/client-runtime/state/thread-folders";
import { FolderOpenIcon } from "lucide-react";
import { msg, T, useGT } from "gt-react";
import { useState, type ReactNode } from "react";

import { m } from "../../i18n/messages";
import { cn } from "~/lib/utils";
import {
  initialProjectIconDraft,
  projectIconColorClassName,
  projectIconFromDraft,
} from "../../projectIconOptions";
import { readLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { findThreadFolderProject } from "../../state/threadFolderLaunch";
import { mutateThreadFolders } from "../../state/threadFolders";
import { ProjectIconOverrideGlyph } from "../ProjectFavicon";
import { ProjectIconPicker } from "../settings/ProjectIconPickerDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { buildFolderUpdate } from "./folderCustomize.logic";
import { threadFolderTintClassName } from "./SidebarThreadFolderHeader";

const MAX_NAME_LENGTH = 80;

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function FolderCardPreview({
  folder,
  name,
  icon,
}: {
  folder: EnvironmentThreadFolder;
  name: string;
  icon: ReturnType<typeof projectIconFromDraft>;
}) {
  const color = icon && icon.kind !== "emoji" ? icon.color : null;
  const nameClassName = color ? projectIconColorClassName(color) : "text-foreground";
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-border/60 px-2",
        threadFolderTintClassName(icon),
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-[25%]",
          icon?.kind !== "monogram" && "bg-current/14",
          nameClassName,
        )}
      >
        {icon ? (
          <ProjectIconOverrideGlyph
            icon={icon}
            className={icon.kind === "monogram" ? "size-5" : "size-3.5"}
          />
        ) : (
          <FolderOpenIcon className="size-3.5" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", nameClassName)}>
        {name.trim() || folder.name}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {folder.threadIds.length}
      </span>
    </div>
  );
}

export default function FolderCustomizeDialog(props: {
  folder: EnvironmentThreadFolder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="w-full sm:w-[34rem]">
        {/* The popup mounts per open, so the draft below starts from the folder each time. */}
        <FolderCustomizeBody folder={props.folder} onClose={() => props.onOpenChange(false)} />
      </DialogPopup>
    </Dialog>
  );
}

function FolderCustomizeBody({
  folder,
  onClose,
}: {
  folder: EnvironmentThreadFolder;
  onClose: () => void;
}) {
  const gt = useGT();
  const [name, setName] = useState(folder.name);
  const [hasIcon, setHasIcon] = useState(folder.icon !== null);
  const [iconDraft, setIconDraft] = useState(() =>
    initialProjectIconDraft(folder.icon, folder.name),
  );
  const [workspaceRoot, setWorkspaceRoot] = useState(folder.workspaceRoot ?? "");
  const [saving, setSaving] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  // The native picker browses this machine, so it only fits folders on the local environment.
  const canPickDirectory =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    folder.environmentId === primaryEnvironmentId;

  const icon = hasIcon ? projectIconFromDraft(iconDraft) : null;
  const iconInvalid = hasIcon && icon === null;
  const update = buildFolderUpdate(folder, { name, icon, workspaceRoot });
  const typedRoot = workspaceRoot.trim();
  const rootHasProject =
    typedRoot === "" ||
    findThreadFolderProject(
      { environmentId: folder.environmentId, workspaceRoot: typedRoot },
      projects,
    ) !== null;

  const pickDirectory = async () => {
    const api = readLocalApi();
    if (!api) return;
    const picked = await api.dialogs
      .pickFolder(typedRoot ? { initialPath: typedRoot } : undefined)
      .catch(() => null);
    if (picked) setWorkspaceRoot(picked);
  };
  const nameInvalid = name.trim() === "";

  const save = async () => {
    if (update === null) {
      onClose();
      return;
    }
    setSaving(true);
    const result = await mutateThreadFolders(
      folder.environmentId,
      update,
      m(msg("Could not save folder")),
    );
    setSaving(false);
    if (result !== null) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <T>Customize folder</T>
        </DialogTitle>
        <DialogDescription>
          <T>Change the folder's name, icon, color, and working directory.</T>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <Field
          label={gt("Name", { $context: "folder name field" })}
          htmlFor="folder-customize-name"
        >
          <Input
            id="folder-customize-name"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            aria-invalid={nameInvalid}
            autoComplete="off"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field
          label={gt("Working directory", { $context: "folder directory field" })}
          htmlFor="folder-customize-workspace-root"
        >
          <div className="flex gap-2">
            <Input
              id="folder-customize-workspace-root"
              className="min-w-0 flex-1"
              value={workspaceRoot}
              placeholder={gt("None: threads open in their own project")}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setWorkspaceRoot(event.currentTarget.value)}
            />
            {canPickDirectory ? (
              <Button variant="outline" size="sm" onClick={() => void pickDirectory()}>
                <T>Choose…</T>
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {rootHasProject ? (
              <T>New threads started from this folder work in this directory.</T>
            ) : (
              <T>
                This directory is not a project yet. Add it as a project before starting threads
                from this folder.
              </T>
            )}
          </p>
        </Field>
        <ProjectIconPicker
          draft={iconDraft}
          onDraftChange={(draft) => {
            setIconDraft(draft);
            setHasIcon(true);
          }}
          preview={
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label render={<div />}>
                  <T>Preview</T>
                </Label>
                {hasIcon ? (
                  <Button size="xs" variant="ghost-destructive" onClick={() => setHasIcon(false)}>
                    <T>Remove icon</T>
                  </Button>
                ) : null}
              </div>
              <FolderCardPreview folder={folder} name={name} icon={icon} />
            </div>
          }
        />
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          <T>Cancel</T>
        </Button>
        <Button onClick={() => void save()} disabled={saving || nameInvalid || iconInvalid}>
          {saving ? <T>Saving…</T> : <T>Save</T>}
        </Button>
      </DialogFooter>
    </>
  );
}
