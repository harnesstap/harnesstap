import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentApiError,
  addAllProfileResources,
  addProfileResource,
  attachProfileComposition,
  cancelSwitch,
  commitProfileResource,
  cutProfile,
  openResourcePath,
  removeProfileResource,
  renameProfile,
  restoreProfileFile,
  runConstraintRecoveryAction,
  startSwitch,
  subscribeSwitchEvents,
  popProfileStash,
  stashActiveProfile,
} from "../lib/agent-client";
import { postApply } from "../lib/api/apply-plugin";
import { postApprove, postDeny } from "../lib/api/approve";
import { formatScope, scopeToView, type Scope } from "../lib/api/scope";
import { flattenProfileResourceList } from "../lib/contents-diff";
import type { CutVersionRow } from "../lib/cut-versions-form";
import {
  trustFieldsFromUnknown,
  type ExecutableTrustFields,
} from "../lib/pending-approvals";
import {
  MUTATION_CHUNK_SIZE,
  partitionProfileInventory,
  planProfileDiskSnapshot,
  profileDiskSnapshotHasWork,
  settleInChunks,
} from "../lib/profile-inventory";
import {
  applyProfileRailOrder,
  loadProfileRailOrder,
  pinNameFirst,
  resolveRailProfileSelection,
  saveProfileRailOrder,
  type ProfileSelectionIntent,
} from "../lib/profile-rail-order";
import { resolveProfileResourceStack } from "../lib/profile-resource-stack";
import {
  APPLY_SUCCESS_HOLD_MS,
  applyCtaHelper,
  applyPreviewChangeCount,
  shouldAutoReapply,
  shouldShowReapply,
} from "../lib/reapply";
import type {
  DriftFileChange,
  GlobalProfileStatus,
  ProfileApplyPreview,
  ProfileContentsResource,
  ProfileSummary,
  ProfileSwitchStepEvent,
  RecoveryAction,
} from "../lib/types";
import type { AgentClient } from "./agent-session";
import {
  previewKeyId,
  selectPreview,
  statusStore,
  useStatusStore,
  type PreviewKey,
} from "./status-store";
import { toast } from "./toast-store";

/** Match CLI `ht profile list --search`: name, description, or tags. */
export function filterProfilesByQuery(
  profiles: ProfileSummary[],
  query: string,
): ProfileSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return profiles;
  }
  return profiles.filter((profile) => {
    const haystack = [profile.name, profile.description ?? "", ...profile.tags]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export interface ScopeControllerInput {
  client: AgentClient | null;
  connected: boolean;
  scope: Scope;
  projectPath: string;
  projectReady: boolean;
  bootstrapBusy: boolean;
  installBusyExternal?: boolean;
  /** Library apply in flight (disables the rail Apply). */
  pluginApplyBusy: boolean;
  onLibraryChanged: () => void;
}

type GlobalDriftStatus = GlobalProfileStatus["drift_summary"]["global"]["status"];
type ProjectDriftStatus = NonNullable<
  GlobalProfileStatus["drift_summary"]["project"]
>["status"];

interface StatusSlice {
  activeProfile: string | null;
  applied: boolean;
  untrackedCount: number;
  globalDrift: GlobalDriftStatus;
  projectDrift: ProjectDriftStatus | undefined;
}

function selectStatusSlice(status: GlobalProfileStatus | null): StatusSlice {
  return {
    activeProfile: status?.active_profile ?? null,
    applied: Boolean(status?.applied),
    untrackedCount: status?.untracked_resource_count ?? 0,
    globalDrift: status?.drift_summary.global.status ?? "clean",
    projectDrift: status?.drift_summary.project?.status,
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Scope-domain state and actions: profile selection and rail order, apply /
 * switch progress, preview, inventory mutations, stash, rename, cut.
 * Reads volatile status through the store at call time so callbacks stay
 * stable across polls.
 */
export function useScopeController(input: ScopeControllerInput) {
  const {
    client,
    connected,
    scope,
    projectPath,
    projectReady,
    bootstrapBusy,
    pluginApplyBusy,
    onLibraryChanged,
  } = input;
  const view = scopeToView(scope);
  const scopeProjectPath = scope === "project" ? projectPath : null;

  const slice = useStatusStore((state) => selectStatusSlice(state.status));
  const { activeProfile, applied, untrackedCount } = slice;
  const profiles = useStatusStore((state) => state.profiles);
  const profilesError = useStatusStore((state) => state.profilesError);
  const stashEntries = useStatusStore((state) => state.stash);

  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  /** `unset` follows the active profile on open; `user` / `empty` keep a session pick. */
  const [profileSelectionIntent, setProfileSelectionIntent] =
    useState<ProfileSelectionIntent>("unset");
  const [profileFilter, setProfileFilter] = useState("");
  const [profileRailOrder, setProfileRailOrder] = useState(loadProfileRailOrder);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [inventoryEditMode, setInventoryEditMode] = useState(false);
  const [previewChanges, setPreviewChanges] = useState(false);
  const [previewRetryKey, setPreviewRetryKey] = useState(0);

  const [switching, setSwitching] = useState(false);
  const [switchSuccessHold, setSwitchSuccessHold] = useState(false);
  const [switchProgressLabel, setSwitchProgressLabel] = useState<string | null>(null);
  const [switchEvents, setSwitchEvents] = useState<ProfileSwitchStepEvent[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState(false);
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false);
  const [reapplyConfirmOpen, setReapplyConfirmOpen] = useState(false);
  const [pendingRestoreChange, setPendingRestoreChange] =
    useState<DriftFileChange | null>(null);
  const [diffFileChange, setDiffFileChange] = useState<DriftFileChange | null>(null);
  const [pendingTrust, setPendingTrust] = useState<ExecutableTrustFields | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [grantBusyRef, setGrantBusyRef] = useState<string | null>(null);

  const [stashBusy, setStashBusy] = useState(false);
  const [stashAction, setStashAction] = useState<"stash" | "unstash" | null>(null);

  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [addingResourceKey, setAddingResourceKey] = useState<string | null>(null);
  const [committingManagedChanges, setCommittingManagedChanges] = useState(false);
  const [removingResourceKey, setRemovingResourceKey] = useState<string | null>(null);
  const [addingAllResources, setAddingAllResources] = useState(false);
  const [overwritingWithSetup, setOverwritingWithSetup] = useState(false);
  const [activatingResources, setActivatingResources] = useState(false);
  const [addResourceError, setAddResourceError] = useState<string | null>(null);
  const [resourceActionError, setResourceActionError] = useState<string | null>(null);
  const [fileChangeBusyPath, setFileChangeBusyPath] = useState<string | null>(null);
  const [fileChangeBusyAction, setFileChangeBusyAction] = useState<
    "open" | "add" | "drop" | null
  >(null);

  const [renamingProfile, setRenamingProfile] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameIgnoreBlurRef = useRef(false);

  const [cutModalOpen, setCutModalOpen] = useState(false);
  const [cutRows, setCutRows] = useState<CutVersionRow[]>([]);
  const [cutBusy, setCutBusy] = useState(false);

  // Project changes invalidate pending executable approvals from the last apply.
  useEffect(() => {
    setPendingTrust(null);
  }, [projectPath]);

  const keyFor = useCallback(
    (profile: string): PreviewKey => ({
      scope,
      projectPath: scopeProjectPath,
      profile,
    }),
    [scope, scopeProjectPath],
  );

  const previewKey = useMemo<PreviewKey | null>(
    () => (selectedProfile ? keyFor(selectedProfile) : null),
    [keyFor, selectedProfile],
  );
  const previewKeyIdValue = previewKey ? previewKeyId(previewKey) : null;
  const preview = useStatusStore((state) => selectPreview(state, previewKey));
  const applyPreview = preview.data;
  const projectPathMissing = scope === "project" && !projectPath;
  const applyPreviewError = selectedProfile && projectPathMissing
    ? "Choose a project directory to preview project apply."
    : preview.error;

  // Keep the last preview on screen while a new one loads (no null-before-refetch).
  useEffect(() => {
    if (!client || !previewKey || switching || projectPathMissing) {
      return;
    }
    void statusStore.loadPreview(previewKey);
    // Intentionally omit status.as_of: fast polls would re-trigger the fetch.
    // Post-switch refresh is covered by `switching` flipping back to false.
    // Keyed on the serialized preview key so a fresh key object does not refetch.
  }, [client, previewKeyIdValue, switching, projectPathMissing, previewRetryKey]);

  const withScope = useCallback(
    <T extends object>(body: T) => ({
      ...body,
      scope: view,
      ...(view === "project" && projectPath ? { projectPath } : {}),
    }),
    [projectPath, view],
  );

  const refreshStatus = useCallback(
    (depth: "fast" | "full" = "fast", path: string = projectPath) =>
      statusStore.refreshStatus(depth, path),
    [projectPath],
  );
  const refreshProfiles = useCallback(
    (path: string = projectPath) => statusStore.refreshProfiles(path),
    [projectPath],
  );
  const refreshStash = useCallback(() => statusStore.refreshStash(), []);

  const loadPreviewFor = useCallback(
    async (profile: string): Promise<ProfileApplyPreview | null> =>
      statusStore.loadPreview(keyFor(profile)),
    [keyFor],
  );

  const visibleProfiles = useMemo(() => {
    const scoped = profiles.filter(
      (profile) => profile.scopes.includes(view) && profile.name !== "empty",
    );
    const orderedNames = pinNameFirst(
      applyProfileRailOrder(
        scoped.map((profile) => profile.name),
        profileRailOrder[view],
      ),
      activeProfile ?? undefined,
    );
    const byName = new Map(scoped.map((profile) => [profile.name, profile]));
    return orderedNames.flatMap((name) => {
      const profile = byName.get(name);
      return profile ? [profile] : [];
    });
  }, [activeProfile, profileRailOrder, profiles, view]);

  const filteredProfiles = useMemo(
    () => filterProfilesByQuery(visibleProfiles, profileFilter),
    [profileFilter, visibleProfiles],
  );

  const canReorderProfiles = connected && !switching && profileFilter.trim() === "";

  const persistRailOrder = useCallback(
    (nextNames: string[]) => {
      setProfileRailOrder(saveProfileRailOrder(view, nextNames));
    },
    [view],
  );

  const clearProfileFilter = useCallback(() => {
    setProfileFilter("");
  }, []);

  const selectProfile = useCallback((name: string) => {
    setProfileSelectionIntent("user");
    setSelectedProfile(name);
    setEditingProfile((current) => (current ? name : null));
    setInventoryEditMode(false);
    setPreviewChanges(false);
  }, []);

  const openEditProfile = useCallback((name: string) => {
    setProfileSelectionIntent("user");
    setSelectedProfile(name);
    setEditingProfile(name);
  }, []);

  const closeEditProfile = useCallback(() => {
    setEditingProfile(null);
  }, []);

  const renameSelected = useCallback((nextName: string) => {
    setProfileSelectionIntent("user");
    setSelectedProfile(nextName);
    setEditingProfile((current) => (current ? nextName : null));
  }, []);

  useEffect(() => {
    const next = resolveRailProfileSelection({
      visibleNames: visibleProfiles.map((profile) => profile.name),
      activeName: activeProfile,
      selectedName: selectedProfile,
      intent: profileSelectionIntent,
    });
    if (next !== selectedProfile) {
      setSelectedProfile(next);
    }
  }, [activeProfile, profileSelectionIntent, selectedProfile, visibleProfiles]);

  const handleProfileDeleted = useCallback(
    (result?: { plugin_name: string; plugin_deleted: boolean }, message?: string) => {
      setProfileSelectionIntent("unset");
      setSelectedProfile(null);
      setEditingProfile(null);
      void refreshProfiles();
      void refreshStatus("full");
      if (message) {
        toast({ tone: "success", title: message });
      } else if (result?.plugin_name) {
        toast({
          tone: "success",
          title: result.plugin_deleted
            ? `Removed profile ${result.plugin_name} and deleted the plugin`
            : `Removed profile ${result.plugin_name}`,
        });
      }
    },
    [refreshProfiles, refreshStatus],
  );

  const runSwitch = useCallback(
    async (
      confirmOwnedOverwrite = false,
      requestedProfile?: string,
      options?: { progressLabel?: string; successToast?: string },
    ) => {
      const targetProfile = requestedProfile ?? selectedProfile;
      if (!client || !targetProfile || !client.token) {
        return;
      }
      setSwitching(true);
      setSwitchSuccessHold(false);
      setSwitchProgressLabel(options?.progressLabel ?? null);
      setSwitchEvents([]);
      setSwitchError(null);
      try {
        const id = await startSwitch(
          client.baseUrl,
          client.token,
          withScope({ profile: targetProfile, confirmOwnedOverwrite }),
        );
        setSwitchId(id);
        subscribeSwitchEvents(
          client.baseUrl,
          id,
          (event) => {
            setSwitchEvents((current) => [...current, event]);
          },
          async (final) => {
            setSwitching(false);
            setSwitchId(null);
            await refreshStatus("full");
            if (!final.ok) {
              setSwitchSuccessHold(false);
              setSwitchProgressLabel(null);
              setSwitchError(
                final.cancelled ? "Switch cancelled" : final.error ?? "Switch failed",
              );
              return;
            }
            setPendingTrust(trustFieldsFromUnknown(final.result));
            setSwitchSuccessHold(true);
            toast({
              tone: "success",
              title:
                options?.successToast
                ?? `Applied ${targetProfile} to ${formatScope(scope)}`,
            });
            window.setTimeout(() => {
              setSwitchSuccessHold(false);
              setSwitchProgressLabel(null);
            }, APPLY_SUCCESS_HOLD_MS);
          },
          (message) => {
            setSwitching(false);
            setSwitchId(null);
            setSwitchSuccessHold(false);
            setSwitchProgressLabel(null);
            setSwitchError(message);
          },
        );
      } catch (error) {
        setSwitching(false);
        setSwitchProgressLabel(null);
        if (
          error instanceof AgentApiError
          && error.code === "owned_overwrite_confirmation_required"
          && !skipOverwritePrompt
        ) {
          setOverwriteDialog(true);
          return;
        }
        setSwitchError(messageOf(error, "Switch failed"));
      }
    },
    [client, refreshStatus, scope, selectedProfile, skipOverwritePrompt, withScope],
  );

  const showReapply = shouldShowReapply({
    selectedProfile,
    activeProfile,
    applied,
    view,
    globalDriftStatus: slice.globalDrift,
    projectDriftStatus: slice.projectDrift,
  });

  const onApplyClick = useCallback(() => {
    if (showReapply) {
      if (!activeProfile) {
        return;
      }
      setReapplyConfirmOpen(true);
      return;
    }
    void runSwitch(false);
  }, [activeProfile, runSwitch, showReapply]);

  const onConfirmReapply = useCallback(() => {
    if (!activeProfile) {
      return;
    }
    setReapplyConfirmOpen(false);
    void runSwitch(false, activeProfile);
  }, [activeProfile, runSwitch]);

  const onConfirmOverwrite = useCallback(() => {
    setOverwriteDialog(false);
    void runSwitch(true, showReapply ? activeProfile ?? undefined : undefined);
  }, [activeProfile, runSwitch, showReapply]);

  const onCancelSwitch = useCallback(async () => {
    if (!client || !client.token || !switchId) {
      return;
    }
    try {
      await cancelSwitch(client.baseUrl, client.token, switchId);
    } catch (error) {
      setSwitchError(messageOf(error, "Could not cancel switch"));
    }
  }, [client, switchId]);

  /** Snapshot drift/apply state before a mutation so auto re-apply reads pre-mutation truth. */
  const autoReapplyInput = useCallback(
    (mutatedProfile: string, affectsApply: boolean) => {
      const current = selectStatusSlice(statusStore.getState().status);
      return {
        mutatedProfile,
        activeProfile: current.activeProfile,
        applied: current.applied,
        view,
        preexistingGlobalDriftStatus: current.globalDrift,
        preexistingProjectDriftStatus: current.projectDrift,
        affectsApply,
      };
    },
    [view],
  );

  const maybeAutoReapplyAfterMutation = useCallback(
    async (mutation: {
      profileName: string;
      affectsApply: boolean;
      addedName?: string;
    }) => {
      const shouldReapply = shouldAutoReapply(
        autoReapplyInput(mutation.profileName, mutation.affectsApply),
      );
      const current = statusStore.getState().status?.active_profile ?? null;
      await refreshProfiles();
      if (mutation.profileName === selectedProfile || mutation.profileName === current) {
        await refreshStatus("full");
      }
      if (shouldReapply) {
        await runSwitch(true, mutation.profileName, {
          progressLabel: "Applying to match profile",
          successToast: mutation.addedName
            ? `Added ${mutation.addedName} and applied`
            : undefined,
        });
      }
    },
    [autoReapplyInput, refreshProfiles, refreshStatus, runSwitch, selectedProfile],
  );

  const handleRecoveryAction = useCallback(
    async (action: RecoveryAction) => {
      if (!client || !selectedProfile || recoveryBusy) {
        return;
      }
      const key = keyFor(selectedProfile);
      let chosenVersion: string | undefined;
      if (action.id === "override-version") {
        if (action.versions.length === 1) {
          chosenVersion = action.versions[0];
        } else {
          const promptResult = window.prompt(
            `Choose version for ${action.pluginName}`,
            action.versions[0] ?? "",
          );
          if (!promptResult || promptResult.trim().length === 0) {
            return;
          }
          chosenVersion = promptResult.trim();
          if (!action.versions.includes(chosenVersion)) {
            statusStore.setPreviewError(
              key,
              `Version "${chosenVersion}" is not available. Choose one of: ${action.versions.join(", ")}`,
            );
            return;
          }
        }
      }
      setRecoveryBusy(true);
      statusStore.setPreviewError(key, null);
      try {
        await runConstraintRecoveryAction(client.baseUrl, client.token, {
          root: selectedProfile,
          action,
          ...(chosenVersion ? { chosenVersion } : {}),
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        const next = await loadPreviewFor(selectedProfile);
        toast({
          tone: "success",
          title: next?.warning
            ? `Recovered: ${action.label}. Review remaining issues.`
            : `Recovered: ${action.label}`,
        });
        if (selectedProfile === statusStore.getState().status?.active_profile) {
          await refreshStatus("full");
        }
      } catch (error) {
        statusStore.setPreviewError(key, messageOf(error, "Could not run recovery action"));
      } finally {
        setRecoveryBusy(false);
      }
    },
    [client, keyFor, loadPreviewFor, projectPath, recoveryBusy, refreshStatus, selectedProfile, view],
  );

  const handleOverwriteWithCurrentSetup = useCallback(async () => {
    if (!client || !selectedProfile || overwritingWithSetup) {
      return;
    }
    const liveContents = statusStore.getState().status?.contents;
    const previewMatchesSelection =
      Boolean(selectedProfile)
      && applyPreview?.profile === selectedProfile;
    const resourceStack = resolveProfileResourceStack({
      selectedProfile,
      activeProfile,
      relativeToActive: applyPreview?.relative_to_active ?? false,
      previewMatchesSelection,
      liveContents,
      targetContents: applyPreview?.contents ?? null,
    });
    if (resourceStack.kind === "loading") {
      setAddResourceError("Wait for inventory to finish loading, then try again.");
      return;
    }
    const profileRows = flattenProfileResourceList(resourceStack.contents, {
      selectedProfile,
    });
    const liveRows = flattenProfileResourceList(liveContents ?? null, {
      selectedProfile,
    });
    const fileChanges = applyPreview?.files?.changes ?? [];
    const plan = planProfileDiskSnapshot(
      partitionProfileInventory({
        profileRows,
        liveRows,
        notStaged: applyPreview?.not_staged ?? applyPreview?.untracked_resources ?? [],
        fileChanges,
      }),
      fileChanges,
    );
    if (!profileDiskSnapshotHasWork(plan)) {
      toast({ tone: "success", title: "Already matches disk" });
      return;
    }
    setOverwritingWithSetup(true);
    setAddResourceError(null);
    try {
      const results = [
        ...(await settleInChunks(plan.toAdd, MUTATION_CHUNK_SIZE, async (resource) => {
          await addProfileResource(
            client.baseUrl,
            client.token,
            selectedProfile,
            withScope({
              resourceType: resource.type,
              resourceName: resource.name,
            }),
          );
        })),
        ...(await settleInChunks(plan.commitPaths, MUTATION_CHUNK_SIZE, async (path) => {
          await commitProfileResource(
            client.baseUrl,
            client.token,
            selectedProfile,
            withScope({ path }),
          );
        })),
        ...(await settleInChunks(plan.toRemove, MUTATION_CHUNK_SIZE, async (item) => {
          await removeProfileResource(client.baseUrl, client.token, selectedProfile, {
            resourceType: item.resource.type,
            resourceName: item.resource.name,
            ...(item.pluginId ? { pluginId: item.pluginId } : {}),
          });
        })),
      ];
      const failed = results.find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") {
        throw failed.reason;
      }
      await loadPreviewFor(selectedProfile);
      await refreshStatus("full");
      toast({ tone: "success", title: "Profile matches current setup" });
    } catch (error) {
      setAddResourceError(
        messageOf(error, "Could not overwrite profile with current setup"),
      );
    } finally {
      setOverwritingWithSetup(false);
    }
  }, [
    activeProfile,
    applyPreview,
    client,
    loadPreviewFor,
    overwritingWithSetup,
    refreshStatus,
    selectedProfile,
    withScope,
  ]);

  const handleCommitManagedChanges = useCallback(async () => {
    if (!client || !selectedProfile || !applyPreview || committingManagedChanges) {
      return;
    }
    const paths = (applyPreview.files?.changes ?? [])
      .filter((change) => change.type === "modified")
      .map((change) => change.path);
    if (paths.length === 0) {
      return;
    }
    setCommittingManagedChanges(true);
    setAddResourceError(null);
    try {
      for (const path of paths) {
        await commitProfileResource(
          client.baseUrl,
          client.token,
          selectedProfile,
          withScope({ path }),
        );
      }
      await loadPreviewFor(selectedProfile);
      if (selectedProfile === statusStore.getState().status?.active_profile) {
        await refreshStatus("full");
      }
    } catch (error) {
      setAddResourceError(
        messageOf(error, "Could not commit live changes into profile"),
      );
    } finally {
      setCommittingManagedChanges(false);
    }
  }, [applyPreview, client, committingManagedChanges, loadPreviewFor, refreshStatus, selectedProfile, withScope]);

  const refreshProfilePreview = useCallback(async () => {
    const current = statusStore.getState().status?.active_profile ?? null;
    const previewProfile = selectedProfile ?? current;
    if (!client || !previewProfile) {
      return;
    }
    await loadPreviewFor(previewProfile);
    if (previewProfile === current) {
      await refreshStatus("full");
    }
  }, [client, loadPreviewFor, refreshStatus, selectedProfile]);

  const handleOpenResourceInEditor = useCallback(
    async (resource: ProfileContentsResource) => {
      if (!client || !client.token) {
        return;
      }
      setResourceActionError(null);
      try {
        const selector = resource.id ?? `${resource.type}:${resource.name}`;
        await openResourcePath(client.baseUrl, client.token, {
          selector,
          pathHint: resource.source ?? null,
        });
      } catch (error) {
        setResourceActionError(messageOf(error, "Could not open resource in editor"));
      }
    },
    [client],
  );

  const handleOpenFileChange = useCallback(
    async (change: DriftFileChange, absolutePath: string) => {
      if (!client || !client.token || fileChangeBusyPath) {
        return;
      }
      setFileChangeBusyPath(change.path);
      setFileChangeBusyAction("open");
      setResourceActionError(null);
      try {
        await openResourcePath(client.baseUrl, client.token, { path: absolutePath });
      } catch (error) {
        setResourceActionError(messageOf(error, "Could not open file in editor"));
      } finally {
        setFileChangeBusyPath(null);
        setFileChangeBusyAction(null);
      }
    },
    [client, fileChangeBusyPath],
  );

  const handleDiffFileChange = useCallback((change: DriftFileChange) => {
    setDiffFileChange(change);
  }, []);

  const handleAddFileChange = useCallback(
    async (change: DriftFileChange) => {
      const profileName =
        selectedProfile ?? statusStore.getState().status?.active_profile ?? null;
      if (!client || !profileName || fileChangeBusyPath) {
        return;
      }
      setFileChangeBusyPath(change.path);
      setFileChangeBusyAction("add");
      setResourceActionError(null);
      try {
        if (change.type === "modified") {
          await commitProfileResource(
            client.baseUrl,
            client.token,
            profileName,
            withScope({ path: change.path }),
          );
        } else if (change.type === "added" && change.resource) {
          await addProfileResource(
            client.baseUrl,
            client.token,
            profileName,
            withScope({
              resourceType: change.resource.type,
              resourceName: change.resource.name,
            }),
          );
        } else {
          return;
        }
        await refreshProfilePreview();
      } catch (error) {
        setResourceActionError(
          messageOf(error, "Could not commit file change into profile"),
        );
      } finally {
        setFileChangeBusyPath(null);
        setFileChangeBusyAction(null);
      }
    },
    [client, fileChangeBusyPath, refreshProfilePreview, selectedProfile, withScope],
  );

  const executeDropFileChange = useCallback(
    async (change: DriftFileChange) => {
      const profileName =
        selectedProfile ?? statusStore.getState().status?.active_profile ?? null;
      if (!client || !profileName || fileChangeBusyPath) {
        return;
      }
      setFileChangeBusyPath(change.path);
      setFileChangeBusyAction("drop");
      setResourceActionError(null);
      try {
        if (change.type === "modified") {
          await restoreProfileFile(
            client.baseUrl,
            client.token,
            profileName,
            withScope({ path: change.path }),
          );
        } else if (change.resource) {
          await removeProfileResource(client.baseUrl, client.token, profileName, {
            resourceType: change.resource.type,
            resourceName: change.resource.name,
          });
        } else {
          return;
        }
        await refreshProfilePreview();
      } catch (error) {
        setResourceActionError(messageOf(error, "Could not drop file change"));
      } finally {
        setFileChangeBusyPath(null);
        setFileChangeBusyAction(null);
      }
    },
    [client, fileChangeBusyPath, refreshProfilePreview, selectedProfile, withScope],
  );

  const handleDropFileChange = useCallback(
    async (change: DriftFileChange) => {
      // Restoring a modified file overwrites live content and cannot be undone.
      if (change.type === "modified") {
        setPendingRestoreChange(change);
        return;
      }
      await executeDropFileChange(change);
    },
    [executeDropFileChange],
  );

  const onConfirmRestoreFile = useCallback(() => {
    const change = pendingRestoreChange;
    setPendingRestoreChange(null);
    if (!change) {
      return;
    }
    void executeDropFileChange(change);
  }, [executeDropFileChange, pendingRestoreChange]);

  const handleAddAllResources = useCallback(
    async (profileName?: string, resources?: Array<{ type: string; name: string }>) => {
      const targetProfile =
        profileName
        ?? selectedProfile
        ?? statusStore.getState().status?.active_profile
        ?? null;
      if (!client || !targetProfile || addingAllResources) {
        return;
      }
      setAddingAllResources(true);
      setAddResourceError(null);
      try {
        if (resources && resources.length > 0) {
          for (const resource of resources) {
            await addProfileResource(
              client.baseUrl,
              client.token,
              targetProfile,
              withScope({ resourceType: resource.type, resourceName: resource.name }),
            );
          }
        } else {
          await addAllProfileResources(
            client.baseUrl,
            client.token,
            targetProfile,
            withScope({}),
          );
        }
        const previewProfile =
          selectedProfile === targetProfile ? targetProfile : selectedProfile;
        if (previewProfile) {
          await loadPreviewFor(previewProfile);
        }
        await refreshStatus("full");
      } catch (error) {
        setAddResourceError(messageOf(error, "Could not add all resources to profile"));
      } finally {
        setAddingAllResources(false);
      }
    },
    [addingAllResources, client, loadPreviewFor, refreshStatus, selectedProfile, withScope],
  );

  const handleActivateResources = useCallback(async () => {
    if (!selectedProfile || selectedProfile !== activeProfile || activatingResources) {
      return;
    }
    setActivatingResources(true);
    setAddResourceError(null);
    try {
      await runSwitch(true, selectedProfile);
    } catch (error) {
      setAddResourceError(messageOf(error, "Could not activate resources"));
      throw error;
    } finally {
      setActivatingResources(false);
    }
  }, [activatingResources, activeProfile, runSwitch, selectedProfile]);

  const handleAttachLibraryItem = useCallback(
    async (item: { kind: "plugin" | "resource"; id: string; name: string; type: string }) => {
      if (!client || !selectedProfile) {
        return;
      }
      setAddResourceError(null);
      try {
        await attachProfileComposition(
          client.baseUrl,
          client.token,
          selectedProfile,
          item.kind === "plugin" ? { pluginId: item.id } : { resourceId: item.id },
        );
        await refreshProfilePreview();
        await maybeAutoReapplyAfterMutation({
          profileName: selectedProfile,
          affectsApply: true,
          addedName: item.name,
        });
      } catch (error) {
        setAddResourceError(messageOf(error, "Could not add library item to profile"));
        throw error;
      }
    },
    [client, maybeAutoReapplyAfterMutation, refreshProfilePreview, selectedProfile],
  );

  const handleAddResource = useCallback(
    async (
      resource: ProfileContentsResource,
      profileOverride?: string,
      options?: { skipAutoReapply?: boolean },
    ) => {
      const profileName = profileOverride ?? selectedProfile;
      if (!client || !profileName) {
        return;
      }
      const key = `${resource.type}:${resource.name}`;
      const reapplyInput = autoReapplyInput(profileName, true);
      setAddingResourceKey(key);
      setAddResourceError(null);
      try {
        await addProfileResource(
          client.baseUrl,
          client.token,
          profileName,
          withScope({ resourceType: resource.type, resourceName: resource.name }),
        );
        await loadPreviewFor(profileName);
        if (options?.skipAutoReapply) {
          return;
        }
        if (shouldAutoReapply(reapplyInput)) {
          await runSwitch(true, profileName, {
            progressLabel: "Applying to match profile",
            successToast: `Added ${resource.name} and applied`,
          });
        } else if (profileName === reapplyInput.activeProfile) {
          await refreshStatus("full");
        }
      } catch (error) {
        setAddResourceError(messageOf(error, "Could not add resource to profile"));
        throw error;
      } finally {
        setAddingResourceKey(null);
      }
    },
    [autoReapplyInput, client, loadPreviewFor, refreshStatus, runSwitch, selectedProfile, withScope],
  );

  const handleRemoveResourceFromProfile = useCallback(
    async (resource: ProfileContentsResource, pluginId?: string) => {
      const profileName =
        selectedProfile ?? statusStore.getState().status?.active_profile ?? null;
      if (!client || !profileName || removingResourceKey) {
        return;
      }
      const key = `${resource.type}:${resource.name}`;
      const reapplyInput = autoReapplyInput(profileName, true);
      setRemovingResourceKey(key);
      setResourceActionError(null);
      try {
        await removeProfileResource(client.baseUrl, client.token, profileName, {
          resourceType: resource.type,
          resourceName: resource.name,
          ...(pluginId ? { pluginId } : {}),
        });
        await refreshProfilePreview();
        if (shouldAutoReapply(reapplyInput)) {
          await runSwitch(true, profileName);
        }
      } catch (error) {
        setResourceActionError(messageOf(error, "Could not remove resource from profile"));
        throw error;
      } finally {
        setRemovingResourceKey(null);
      }
    },
    [autoReapplyInput, client, refreshProfilePreview, removingResourceKey, runSwitch, selectedProfile],
  );

  const onProfileCreated = useCallback(
    async (profileName: string, shouldSwitch: boolean) => {
      await refreshProfiles();
      selectProfile(profileName);
      toast({ tone: "success", title: `Created profile ${profileName}` });
      if (shouldSwitch) {
        await runSwitch(false, profileName);
      }
    },
    [refreshProfiles, runSwitch, selectProfile],
  );

  const onStashProfile = useCallback(async () => {
    if (!client || !client.token || stashBusy || switching) {
      return;
    }
    setStashBusy(true);
    setStashAction("stash");
    setSwitchError(null);
    try {
      const result = await stashActiveProfile(client.baseUrl, client.token);
      await refreshStatus("full");
      await refreshStash();
      const current = statusStore.getState().status?.active_profile ?? activeProfile;
      if (current && selectedProfile === current) {
        await loadPreviewFor(current);
      }
      const count = result.entry.contents.resources.length;
      toast({
        tone: "success",
        title: `Stashed ${count} untracked resource${count === 1 ? "" : "s"}`,
      });
    } catch (error) {
      setSwitchError(messageOf(error, "Could not stash profile"));
    } finally {
      setStashBusy(false);
      setStashAction(null);
    }
  }, [activeProfile, client, loadPreviewFor, refreshStash, refreshStatus, selectedProfile, stashBusy, switching]);

  const onUnstashProfile = useCallback(async () => {
    if (!client || !client.token || stashBusy || switching || stashEntries.length === 0) {
      return;
    }
    setStashBusy(true);
    setStashAction("unstash");
    setSwitchError(null);
    try {
      const result = await popProfileStash(client.baseUrl, client.token);
      if (result.restored.cancelled) {
        setSwitchError("Restore cancelled");
        return;
      }
      selectProfile(result.entry.profile_name);
      await refreshProfiles();
      await refreshStatus("full");
      await refreshStash();
      const count = result.entry.contents.resources.length;
      toast({
        tone: "success",
        title: `Restored ${count} untracked resource${count === 1 ? "" : "s"}`,
      });
    } catch (error) {
      setSwitchError(messageOf(error, "Could not restore stashed profile"));
    } finally {
      setStashBusy(false);
      setStashAction(null);
    }
  }, [client, refreshProfiles, refreshStash, refreshStatus, selectProfile, stashBusy, stashEntries.length, switching]);

  const runProjectInstall = useCallback(async () => {
    if (!client || !client.token || !projectPath) {
      return;
    }
    setInstallBusy(true);
    setSwitchError(null);
    try {
      const result = await postApply(client.baseUrl, client.token, {
        plugins: [],
        scope: "project",
        projectPath,
        onConflict: "replace",
        confirmOwnedOverwrite: true,
      });
      setPendingTrust(trustFieldsFromUnknown(result));
      toast({ tone: "success", title: "Installed project from apm.yml" });
      await refreshStatus("full");
    } catch (error) {
      setSwitchError(messageOf(error, "Install failed"));
    } finally {
      setInstallBusy(false);
    }
  }, [client, projectPath, refreshStatus]);

  const decidePendingApproval = useCallback(
    async (side: "allow" | "deny", ref: string) => {
      if (!client || !client.token || !projectPath) {
        return;
      }
      setGrantBusyRef(ref);
      setSwitchError(null);
      try {
        if (side === "allow") {
          await postApprove(client.baseUrl, client.token, { projectPath, refs: [ref] });
        } else {
          await postDeny(client.baseUrl, client.token, { projectPath, refs: [ref] });
        }
        const result = await postApply(client.baseUrl, client.token, {
          plugins: [],
          scope: "project",
          projectPath,
          onConflict: "replace",
          confirmOwnedOverwrite: true,
        });
        setPendingTrust(trustFieldsFromUnknown(result));
        await refreshStatus("full");
      } catch (error) {
        setSwitchError(messageOf(error, "Could not update executable grant"));
      } finally {
        setGrantBusyRef(null);
      }
    },
    [client, projectPath, refreshStatus],
  );

  const setPendingTrustFromResult = useCallback((result: unknown) => {
    setPendingTrust(trustFieldsFromUnknown(result));
  }, []);

  // Rename (double-click on the live pane title).
  const beginRenameSelectedProfile = useCallback(() => {
    if (!selectedProfile || !connected || switching || renameBusy) {
      return;
    }
    renameIgnoreBlurRef.current = false;
    setRenameDraft(selectedProfile);
    setRenameError(null);
    setRenamingProfile(true);
  }, [connected, renameBusy, selectedProfile, switching]);

  const cancelRenameSelectedProfile = useCallback(() => {
    renameIgnoreBlurRef.current = true;
    setRenamingProfile(false);
    setRenameDraft("");
    setRenameError(null);
  }, []);

  const commitRenameSelectedProfile = useCallback(async () => {
    if (!client || !selectedProfile || renameBusy || renameIgnoreBlurRef.current) {
      return;
    }
    const nextName = renameDraft.trim();
    if (!nextName) {
      setRenameError("Name is required");
      window.setTimeout(() => renameInputRef.current?.focus(), 0);
      return;
    }
    if (nextName === selectedProfile) {
      cancelRenameSelectedProfile();
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await renameProfile(client.baseUrl, client.token, selectedProfile, nextName);
      setProfileSelectionIntent("user");
      setSelectedProfile(result.name);
      renameIgnoreBlurRef.current = true;
      setRenamingProfile(false);
      setRenameDraft("");
      await Promise.all([refreshProfiles(), refreshStatus("full")]);
      toast({ tone: "success", title: `Renamed to ${result.name}` });
    } catch (error) {
      if (error instanceof AgentApiError && error.code === "plugin_exists") {
        setRenameError("A profile with this name already exists.");
      } else if (error instanceof AgentApiError && error.code === "not_found") {
        setRenameError("Rename is unavailable. Restart Desktop to reload the sidecar.");
      } else {
        setRenameError(messageOf(error, "Could not rename profile"));
      }
      window.setTimeout(() => renameInputRef.current?.focus(), 0);
    } finally {
      setRenameBusy(false);
    }
  }, [cancelRenameSelectedProfile, client, refreshProfiles, refreshStatus, renameBusy, renameDraft, selectedProfile]);

  useEffect(() => {
    if (!renamingProfile) {
      return;
    }
    const timer = window.setTimeout(() => {
      const input = renameInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renamingProfile]);

  useEffect(() => {
    if (!renamingProfile) {
      return;
    }
    if (!selectedProfile || switching) {
      cancelRenameSelectedProfile();
    }
  }, [cancelRenameSelectedProfile, renamingProfile, selectedProfile, switching]);

  // Cut version.
  const openCutForProfile = useCallback((name: string, version: string) => {
    setCutRows([{ name, currentVersion: version, newVersion: version }]);
    setCutModalOpen(true);
  }, []);

  const handleCutConfirm = useCallback(async () => {
    if (!client || !client.token || cutBusy || cutRows.length === 0) {
      return;
    }
    setCutBusy(true);
    setSwitchError(null);
    try {
      for (const row of cutRows) {
        await cutProfile(client.baseUrl, client.token, row.name, row.newVersion.trim());
      }
      setCutModalOpen(false);
      await refreshProfiles();
      await refreshStatus("full");
      if (selectedProfile) {
        await loadPreviewFor(selectedProfile);
      }
      toast({
        tone: "success",
        title: `Cut version for ${cutRows.map((row) => row.name).join(", ")}`,
      });
    } catch (error) {
      setSwitchError(messageOf(error, "Could not cut profile version"));
    } finally {
      setCutBusy(false);
    }
  }, [client, cutBusy, cutRows, loadPreviewFor, refreshProfiles, refreshStatus, selectedProfile]);

  const closeCutModal = useCallback(() => {
    if (!cutBusy) {
      setCutModalOpen(false);
    }
  }, [cutBusy]);

  // Derived rail state.
  const selectedProfileSummary = useMemo(
    () => profiles.find((profile) => profile.name === selectedProfile) ?? null,
    [profiles, selectedProfile],
  );
  const selectedIsActive = Boolean(selectedProfile && selectedProfile === activeProfile);
  const activeProfileUntrackedCount = useMemo(() => {
    if (!activeProfile) {
      return 0;
    }
    if (selectedProfile === activeProfile && applyPreview?.profile === activeProfile) {
      return applyPreview.not_staged?.length ?? applyPreview.untracked_resources.length;
    }
    if (scope === "global") {
      return untrackedCount;
    }
    return 0;
  }, [activeProfile, applyPreview, scope, selectedProfile, untrackedCount]);

  const canStashProfile = scope === "global" && Boolean(activeProfile) && untrackedCount > 0;
  const canUnstashProfile = stashEntries.length > 0;
  const stashDisabledReason = !activeProfile
    ? "No active profile to stash"
    : scope !== "global"
      ? "Switch to Global view to stash"
      : untrackedCount > 0
        ? undefined
        : "No not-staged resources to stash";

  const applyHelperState = useMemo(
    () =>
      applyCtaHelper({
        selectedProfile,
        activeProfile,
        applied,
        showReapply,
        changeCount: applyPreviewChangeCount(applyPreview),
        switching,
      }),
    [activeProfile, applied, applyPreview, selectedProfile, showReapply, switching],
  );
  const applyHelper = applyHelperState.label;

  const applyButtonTitle = useMemo(() => {
    if (showReapply && activeProfile) {
      return `Re-apply ${activeProfile}`;
    }
    if (!selectedProfile) {
      return "Nothing to apply";
    }
    if (selectedProfile === activeProfile && applied && !showReapply) {
      return "Up to date";
    }
    return `Apply ${selectedProfile}`;
  }, [activeProfile, applied, selectedProfile, showReapply]);

  const applyDisabled =
    !connected
    || switching
    || pluginApplyBusy
    || bootstrapBusy
    || installBusy
    || (scope === "project" && (!projectPath || !projectReady))
    || !selectedProfile
    || (selectedProfile === activeProfile && applied && !showReapply);

  const retryPreview = useCallback(() => setPreviewRetryKey((value) => value + 1), []);
  const dismissPreviewError = useCallback(() => {
    if (previewKey) {
      statusStore.setPreviewError(previewKey, null);
    }
  }, [previewKey]);

  const hasFullHarnessSnapshot = useStatusStore((state) => state.harnessSnapshotComplete);

  return {
    scope,
    view,
    client,
    connected,
    projectPath,
    projectReady,
    // status slice
    activeProfile,
    applied,
    untrackedCount,
    profiles,
    profilesError,
    stashEntries,
    hasFullHarnessSnapshot,
    refreshStatus,
    refreshProfiles,
    refreshStash,
    // preview
    preview,
    applyPreview,
    applyPreviewError,
    retryPreview,
    dismissPreviewError,
    // selection
    selectedProfile,
    selectedProfileSummary,
    selectedIsActive,
    selectProfile,
    clearProfileFilter,
    renameSelected,
    profileFilter,
    setProfileFilter,
    visibleProfiles,
    filteredProfiles,
    canReorderProfiles,
    persistRailOrder,
    editingProfile,
    openEditProfile,
    closeEditProfile,
    inventoryEditMode,
    setInventoryEditMode,
    previewChanges,
    setPreviewChanges,
    activeProfileUntrackedCount,
    // apply
    switching,
    switchSuccessHold,
    switchProgressLabel,
    switchEvents,
    switchError,
    setSwitchError,
    showReapply,
    applyHelper,
    applyHelperState,
    applyButtonTitle,
    applyDisabled,
    onApplyClick,
    onConfirmReapply,
    reapplyConfirmOpen,
    setReapplyConfirmOpen,
    overwriteDialog,
    setOverwriteDialog,
    skipOverwritePrompt,
    setSkipOverwritePrompt,
    onConfirmOverwrite,
    onCancelSwitch,
    runSwitch,
    maybeAutoReapplyAfterMutation,
    handleProfileDeleted,
    onProfileCreated,
    // install / approvals
    installBusy,
    runProjectInstall,
    pendingTrust,
    setPendingTrustFromResult,
    grantBusyRef,
    decidePendingApproval,
    // stash
    stashBusy,
    stashAction,
    canStashProfile,
    canUnstashProfile,
    stashDisabledReason,
    onStashProfile,
    onUnstashProfile,
    // inventory
    addingResourceKey,
    addingAllResources,
    overwritingWithSetup,
    handleOverwriteWithCurrentSetup,
    activatingResources,
    committingManagedChanges,
    removingResourceKey,
    recoveryBusy,
    addResourceError,
    setAddResourceError,
    resourceActionError,
    setResourceActionError,
    fileChangeBusyPath,
    fileChangeBusyAction,
    handleAddResource,
    handleAddAllResources,
    handleActivateResources,
    handleAttachLibraryItem,
    handleCommitManagedChanges,
    handleOpenResourceInEditor,
    handleRemoveResourceFromProfile,
    handleOpenFileChange,
    handleDiffFileChange,
    handleAddFileChange,
    handleDropFileChange,
    handleRecoveryAction,
    pendingRestoreChange,
    setPendingRestoreChange,
    onConfirmRestoreFile,
    diffFileChange,
    setDiffFileChange,
    // rename
    renamingProfile,
    renameDraft,
    setRenameDraft,
    renameError,
    renameBusy,
    renameInputRef,
    beginRenameSelectedProfile,
    cancelRenameSelectedProfile,
    commitRenameSelectedProfile,
    // cut
    cutModalOpen,
    cutRows,
    setCutRows,
    cutBusy,
    openCutForProfile,
    handleCutConfirm,
    closeCutModal,
    onLibraryChanged,
  };
}

export type ScopeController = ReturnType<typeof useScopeController>;
