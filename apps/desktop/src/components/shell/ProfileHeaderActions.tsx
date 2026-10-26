import { useEffect, useState } from "react";
import { Copy, HardDriveUpload, History, Pencil, Tag, Trash2, Unlink, Upload } from "lucide-react";
import {
  detachLibraryPlugin,
  duplicateLibraryPlugin,
  fetchLibraryPluginDetail,
  undoDetachLibraryPlugin,
  type DuplicateMode,
  type LibraryPluginUpstream,
} from "../../lib/api/library-plugins";
import {
  DETACH_UNDO_MS,
  detachedMessage,
  duplicateSuccessMessage,
  parentNameFromRef,
} from "../../lib/duplicate-profile";
import type { ScopeController } from "../../state/scope-controller";
import { toast } from "../../state/toast-store";
import { DuplicateDialog } from "../DuplicateDialog";
import { IconActionButton } from "../IconActionButton";
import { OverflowMenu, type OverflowMenuItem } from "../OverflowMenu";
import { ProfileDeleteControls } from "../parity/ProfileDeleteControls";
import { PublishProfileDrawer } from "../parity/PublishProfileDrawer";
import { ProfileHistoryDialog } from "./ProfileHistoryDialog";

const ICON_SIZE = 18;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Profile page header: Edit and History as icons (Refresh sits before them in
 * the toolbar). Everything else lives in the 3-dot menu, Delete last.
 * Preview changes is the rail link only; project Install and Project history
 * arrive as `projectItems` and join the menu.
 */
export function ProfileHeaderActions({
  ctrl,
  profileName,
  baseUrl,
  token,
  connected,
  switching,
  reloadKey,
  onOverwrite,
  onOpenPlugin,
  onRequestSignIn,
  projectItems = [],
}: {
  ctrl: ScopeController;
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  switching: boolean;
  reloadKey: number;
  onOverwrite: () => void;
  onOpenPlugin: (name: string, version?: string) => void;
  onRequestSignIn: () => void;
  projectItems?: OverflowMenuItem[];
}) {
  const summary = ctrl.selectedProfileSummary;
  const [upstream, setUpstream] = useState<LibraryPluginUpstream | null>(null);
  const [linkEpoch, setLinkEpoch] = useState(0);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = !connected || switching || busy;

  // Only Detach needs the link; one small read per profile.
  useEffect(() => {
    if (!baseUrl) {
      setUpstream(null);
      return;
    }
    let cancelled = false;
    void fetchLibraryPluginDetail(baseUrl, token, profileName)
      .then((detail) => {
        if (!cancelled) setUpstream(detail.plugin.upstream ?? null);
      })
      .catch(() => {
        if (!cancelled) setUpstream(null);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, profileName, reloadKey, linkEpoch]);

  const afterLinkChange = () => {
    setLinkEpoch((value) => value + 1);
    void ctrl.refreshProfiles();
    void ctrl.refreshStatus("full");
  };

  const detachNow = () => {
    if (!baseUrl || !upstream) return;
    const parent = parentNameFromRef(upstream.ref);
    const name = profileName;
    setBusy(true);
    void detachLibraryPlugin(baseUrl, token, name)
      .then((result) => {
        afterLinkChange();
        const undoToken = result.undo_token;
        toast({
          tone: "success",
          title: detachedMessage(name, parent),
          durationMs: DETACH_UNDO_MS,
          ...(undoToken
            ? {
                action: {
                  label: "Undo",
                  onClick: () => {
                    void undoDetachLibraryPlugin(baseUrl, token, name, undoToken)
                      .then(afterLinkChange)
                      .catch((error: unknown) =>
                        toast({ tone: "error", title: errorText(error, "Could not undo") }),
                      );
                  },
                },
              }
            : {}),
        });
      })
      .catch((error: unknown) => toast({ tone: "error", title: errorText(error, "Could not detach") }))
      .finally(() => setBusy(false));
  };

  const confirmDuplicate = (input: { name: string; mode: DuplicateMode }) => {
    if (!baseUrl) return;
    setDuplicateBusy(true);
    void duplicateLibraryPlugin(baseUrl, token, profileName, input)
      .then((result) => {
        setDuplicateOpen(false);
        void ctrl.refreshProfiles();
        toast({
          tone: "success",
          title: duplicateSuccessMessage(profileName, result),
          onOpen: () => ctrl.selectProfile(result.name),
        });
      })
      .catch((error: unknown) => {
        setDuplicateOpen(false);
        toast({ tone: "error", title: errorText(error, "Could not duplicate") });
      })
      .finally(() => setDuplicateBusy(false));
  };

  const overflow: OverflowMenuItem[] = [
    {
      id: "duplicate",
      label: "Duplicate",
      icon: <Copy size={16} aria-hidden />,
      disabled: locked || !baseUrl,
      onSelect: () => setDuplicateOpen(true),
    },
    {
      id: "tag",
      label: "Tag a new version",
      icon: <Tag size={16} aria-hidden />,
      disabled: locked || !token || !summary?.version,
      onSelect: () => ctrl.openCutForProfile(profileName, summary?.version ?? ""),
    },
    ...projectItems,
    {
      id: "overwrite",
      separatorBefore: true,
      label: "Overwrite with current setup",
      icon: <HardDriveUpload size={16} aria-hidden />,
      disabled: locked || ctrl.overwritingWithSetup,
      onSelect: onOverwrite,
    },
    {
      id: "publish",
      label: "Publish",
      icon: <Upload size={16} aria-hidden />,
      disabled: locked || !baseUrl,
      onSelect: () => setPublishOpen(true),
    },
    ...(upstream?.kind === "extends"
      ? [
          {
            id: "detach",
            label: "Detach",
            icon: <Unlink size={16} aria-hidden />,
            disabled: locked,
            onSelect: detachNow,
          },
        ]
      : []),
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 size={16} aria-hidden />,
      danger: true,
      separatorBefore: true,
      disabled: locked,
      onSelect: () => setDeleteOpen(true),
    },
  ];

  return (
    <>
      <IconActionButton
        className="status-edit-action"
        data-testid="profile-edit"
        onClick={() => {
          ctrl.setPreviewChanges(false);
          ctrl.openEditProfile(profileName);
        }}
        disabled={!connected || switching}
        label={`Edit ${profileName}`}
        title="Edit"
        icon={<Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
      />
      <IconActionButton
        className="status-edit-action"
        data-testid="profile-history"
        onClick={() => setHistoryOpen(true)}
        disabled={!connected || !baseUrl}
        label="History"
        title="Browse versions"
        icon={<History size={ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
      />
      <OverflowMenu testId="profile-overflow" items={overflow} disabled={!connected} />
      <ProfileDeleteControls
        profileName={profileName}
        baseUrl={baseUrl}
        token={token}
        disabled={!connected || switching}
        variant="menu"
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={ctrl.handleProfileDeleted}
      />
      <PublishProfileDrawer
        hideTrigger
        open={publishOpen}
        onOpenChange={setPublishOpen}
        profileName={profileName}
        profileVersion={summary?.version ?? ""}
        baseUrl={baseUrl}
        token={token}
        disabled={locked}
        onSuccess={(message) => toast({ tone: "success", title: message })}
        onRequestSignIn={onRequestSignIn}
        onRequestCut={(name, version) => ctrl.openCutForProfile(name, version)}
      />
      <ProfileHistoryDialog
        open={historyOpen}
        profileName={profileName}
        headVersion={summary?.version ?? ""}
        headDirty={summary?.dirty ?? false}
        baseUrl={baseUrl}
        token={token}
        onClose={() => setHistoryOpen(false)}
        onOpenVersion={(version) => onOpenPlugin(profileName, version)}
      />
      <DuplicateDialog
        open={duplicateOpen}
        sourceName={profileName}
        isProfile
        existingNames={new Set(ctrl.profiles.map((profile) => profile.name))}
        busy={duplicateBusy}
        onConfirm={confirmDuplicate}
        onCancel={() => setDuplicateOpen(false)}
      />
    </>
  );
}
