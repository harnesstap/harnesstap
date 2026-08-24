import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Archive, ArchiveRestore, Check, Download, FolderGit2, Globe, Library, PackageSearch, Pencil, Plus, RefreshCw, Settings, Tag, Upload, User } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { shouldAutoReapply, shouldShowReapply } from "./lib/reapply";
import {
  activeHeaderDestination,
  headerClickIntent,
  type HeaderDestination,
  type HeaderWorkspaceFocus,
} from "./lib/header-destination";
import {
  canPopScreenHistory,
  popScreenHistory,
  pushScreenHistory,
} from "./lib/screen-history";
import { ButtonSpinner } from "./components/ButtonSpinner";
import { CloudAccountDrawer } from "./components/CloudAccountDrawer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CutVersionsModal } from "./components/CutVersionsModal";
import { CreateProfileDrawer } from "./components/CreateProfileDrawer";
import { EditProfilePane } from "./components/EditProfilePane";
import { EnvironmentsWorkspace } from "./components/parity/EnvironmentsWorkspace";
import { ParityChrome } from "./components/parity/ParityChrome";
import { ProfileDeleteControls } from "./components/parity/ProfileDeleteControls";
import { ProjectHistoryControl } from "./components/parity/ProjectHistoryControl";
import { FileDiffModal } from "./components/FileDiffModal";
import { LiveStatePanel } from "./components/LiveStatePanel";
import { MigrateExportDrawer } from "./components/MigrateExportDrawer";
import { MigrateImportDrawer } from "./components/MigrateImportDrawer";
import { ProjectPicker } from "./components/ProjectPicker";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SourcesWorkspace } from "./components/SourcesWorkspace";
import { StashBrowseDrawer } from "./components/StashBrowseDrawer";
import { WorkspaceBackButton } from "./components/WorkspaceBackButton";
import {
  AgentApiError,
  bootstrapProject,
  cancelSwitch,
  connectAgent,
  fetchApplyPreview,
  fetchCloudAuthStatus,
  fetchProfileStash,
  fetchProfiles,
  fetchStatus,
  popProfileStash,
  renameProfile,
  stashActiveProfile,
  startSwitch,
  subscribeSwitchEvents,
  addAllProfileResources,
  addProfileResource,
  commitProfileResource,
  cutProfile,
  openResourcePath,
  removeProfileResource,
  restoreProfileFile,
  rescanResourceTrackedDirectories,
  runConstraintRecoveryAction,
} from "./lib/agent-client";
import {
  loadRecentProjects,
  rememberProject,
} from "./lib/recent-projects";
import {
  applyProfileRailOrder,
  insertBeforeIndexForDrop,
  loadProfileRailOrder,
  reorderProfileNames,
  saveProfileRailOrder,
} from "./lib/profile-rail-order";
import type { CutVersionRow } from "./lib/cut-versions-form";
import { mergeStatusUpdate } from "./lib/status-merge";
import type {
  CloudAuthStatus,
  GlobalProfileStatus,
  DriftFileChange,
  ProfileApplyPreview,
  ProfileContentsResource,
  ProfileCreateSource,
  ProfileSummary,
  ProfileSwitchStep,
  ProfileSwitchStepEvent,
  ProfileStashEntry,
  RecoveryAction,
  ViewScope,
} from "./lib/types";
import { orderedSwitchSteps, SWITCH_STEP_LABELS } from "./lib/types";

type WorkspaceFocus = HeaderWorkspaceFocus;

const HEADER_ICON_SIZE = 18;
const RAIL_ICON_SIZE = 15;

/** Match CLI `ht profile list --search`: name, description, or tags. */
function filterProfilesByQuery(
  profiles: ProfileSummary[],
  query: string,
): ProfileSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return profiles;
  }
  return profiles.filter((profile) => {
    const haystack = [
      profile.name,
      profile.description ?? "",
      ...profile.tags,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

const POLL_MS = 2000;
const ACTIVITY_TTL_MS = 60_000;

function formatView(view: ViewScope): string {
  switch (view) {
    case "home":
      return "Global";
    case "project":
      return "Project";
    default: {
      const neverView: never = view;
      return neverView;
    }
  }
}

function stepState(
  step: ProfileSwitchStep,
  events: ProfileSwitchStepEvent[],
): "pending" | "current" | "done" | "failed" {
  const related = events.filter((event) => event.step === step);
  if (related.some((event) => event.status === "failed")) {
    return "failed";
  }
  if (related.some((event) => event.status === "completed")) {
    return "done";
  }
  if (related.some((event) => event.status === "started")) {
    return "current";
  }
  return "pending";
}

function isApplyStepActive(events: ProfileSwitchStepEvent[]): boolean {
  return events.some(
    (event) =>
      (event.step === "apply_home" || event.step === "apply_project")
      && event.status === "started",
  );
}

export function App() {
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [firstRun, setFirstRun] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [stashEntries, setStashEntries] = useState<ProfileStashEntry[]>([]);
  const [stashBusy, setStashBusy] = useState(false);
  const [stashAction, setStashAction] = useState<"stash" | "unstash" | null>(null);
  const [status, setStatus] = useState<GlobalProfileStatus | null>(null);
  const [hasFullHarnessSnapshot, setHasFullHarnessSnapshot] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [applyPreview, setApplyPreview] = useState<ProfileApplyPreview | null>(null);
  const [applyPreviewError, setApplyPreviewError] = useState<string | null>(null);
  const [applyPreviewLoading, setApplyPreviewLoading] = useState(false);
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [addingResourceKey, setAddingResourceKey] = useState<string | null>(null);
  const [committingManagedChanges, setCommittingManagedChanges] = useState(false);
  const [removingResourceKey, setRemovingResourceKey] = useState<string | null>(null);
  const [addingAllResources, setAddingAllResources] = useState(false);
  const [addResourceError, setAddResourceError] = useState<string | null>(null);
  const [resourceActionError, setResourceActionError] = useState<string | null>(null);
  const [fileChangeBusyPath, setFileChangeBusyPath] = useState<string | null>(null);
  const [fileChangeBusyAction, setFileChangeBusyAction] = useState<
    "open" | "add" | "drop" | null
  >(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  /** When true, keep an empty selection until the user picks a profile again. */
  const [preferEmptySelection, setPreferEmptySelection] = useState(false);
  const [profileFilter, setProfileFilter] = useState("");
  const [profileRailOrder, setProfileRailOrder] = useState(loadProfileRailOrder);
  const [draggingProfile, setDraggingProfile] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { name: string; placeAfter: boolean } | "end" | null
  >(null);
  const [workspaceFocus, setWorkspaceFocus] = useState<WorkspaceFocus>("scope");
  const [screenHistory, setScreenHistory] = useState<HeaderDestination[]>([]);
  const [homeResetNonce, setHomeResetNonce] = useState(0);
  const [libraryFocusPlugin, setLibraryFocusPlugin] = useState<string | null>(null);
  const [libraryFocusResource, setLibraryFocusResource] = useState<string | null>(
    null,
  );
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [view, setView] = useState<ViewScope>("home");
  const [switching, setSwitching] = useState(false);
  const [pluginApplyBusy, setPluginApplyBusy] = useState(false);
  const [switchEvents, setSwitchEvents] = useState<ProfileSwitchStepEvent[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState(false);
  const [reapplyConfirmOpen, setReapplyConfirmOpen] = useState(false);
  const [pendingRestoreChange, setPendingRestoreChange] =
    useState<DriftFileChange | null>(null);
  const [diffFileChange, setDiffFileChange] = useState<DriftFileChange | null>(
    null,
  );
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [createProfileInitialSource, setCreateProfileInitialSource] =
    useState<ProfileCreateSource>("compose");
  const [createProfileInitialSwitchAfterCreate, setCreateProfileInitialSwitchAfterCreate] =
    useState(false);
  const [stashBrowseOpen, setStashBrowseOpen] = useState(false);
  const [cloudAccountOpen, setCloudAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [migrateExportOpen, setMigrateExportOpen] = useState(false);
  const [migrateImportOpen, setMigrateImportOpen] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [cloudAuth, setCloudAuth] = useState<CloudAuthStatus | null>(null);
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  /** Project path whose `.harnesstap/config.toml` is known ready (init or already existed). */
  const [projectConfigReadyPath, setProjectConfigReadyPath] = useState<string | null>(
    null,
  );
  const [refreshPhase, setRefreshPhase] = useState<"idle" | "loading" | "success">(
    "idle",
  );
  const [libraryReloadKey, setLibraryReloadKey] = useState(0);
  const [renamingProfile, setRenamingProfile] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [cutModalOpen, setCutModalOpen] = useState(false);
  const [cutRows, setCutRows] = useState<CutVersionRow[]>([]);
  const [cutBusy, setCutBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameIgnoreBlurRef = useRef(false);
  const skipProfileClickRef = useRef(false);
  const [projectPath, setProjectPath] = useState<string>(() => {
    const recent = loadRecentProjects();
    return recent[0]?.path ?? "";
  });
  const lastActivityRef = useRef(Date.now());
  const refreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectProject = useCallback((path: string) => {
    const next = path.trim();
    if (!next) {
      return;
    }
    rememberProject(next);
    setProjectPath(next);
    setBootstrapError(null);
    setProjectConfigReadyPath(null);
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") {
      return;
    }
    void invoke<string | null>("e2e_project_path").then((path) => {
      if (path) {
        selectProject(path);
      }
    });
  }, [selectProject]);

  const browseProject = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select project directory",
        defaultPath: projectPath || undefined,
      });
      if (typeof selected === "string" && selected.length > 0) {
        selectProject(selected);
      }
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Could not open folder picker",
      );
    }
  }, [projectPath, selectProject]);

  const activeProfile = status?.active_profile ?? null;
  const topStashEntry = stashEntries[0];
  const canStashProfile =
    view === "home"
    && Boolean(activeProfile)
    && (status?.untracked_resource_count ?? 0) > 0;
  const canUnstashProfile = stashEntries.length > 0;
  const activeProfileUntrackedCount = useMemo(() => {
    if (!activeProfile) {
      return 0;
    }
    if (
      selectedProfile === activeProfile
      && applyPreview?.profile === activeProfile
    ) {
      return applyPreview.not_staged?.length
        ?? applyPreview.untracked_resources.length;
    }
    if (view === "home") {
      return status?.untracked_resource_count ?? 0;
    }
    return 0;
  }, [
    activeProfile,
    applyPreview,
    selectedProfile,
    status?.untracked_resource_count,
    view,
  ]);
  const stashDisabledReason = !activeProfile
    ? "No active profile to stash"
    : view !== "home"
      ? "Switch to Global view to stash"
      : (status?.untracked_resource_count ?? 0) > 0
        ? undefined
        : "No not-staged resources to stash";
  const projectTracked =
    status?.drift_summary.project?.status !== "na" && status?.drift_summary.project !== undefined;
  // Config init ≠ DB tracking. Project view only needs config.toml; drift "na"
  // still means "never applied", not "needs init again".
  const projectReady =
    Boolean(projectPath)
    && (projectTracked || projectConfigReadyPath === projectPath);

  const refreshStatus = useCallback(
    async (
      depth: "fast" | "full" = "fast",
      path: string = projectPath,
    ): Promise<boolean> => {
      if (!baseUrl || switching) {
        return false;
      }
      try {
        const next = await fetchStatus(
          baseUrl,
          depth,
          path || undefined,
        );
        setStatus((previous) => mergeStatusUpdate(previous, next, depth));
        if (depth === "full") {
          setHasFullHarnessSnapshot(true);
        }
        setStatusError(null);
        setLastUpdated(new Date().toLocaleTimeString());
        return true;
      } catch (error) {
        setStatusError(
          error instanceof Error ? error.message : "Could not read live status",
        );
        return false;
      }
    },
    [baseUrl, projectPath, switching],
  );

  const onRefreshClick = useCallback(async () => {
    if (refreshPhase === "loading") {
      return;
    }
    if (refreshFeedbackTimerRef.current) {
      clearTimeout(refreshFeedbackTimerRef.current);
      refreshFeedbackTimerRef.current = null;
    }
    setRefreshPhase("loading");
    let rescanOk = true;
    if (baseUrl && token) {
      try {
        await rescanResourceTrackedDirectories(baseUrl, token);
        setLibraryReloadKey((value) => value + 1);
      } catch (error) {
        rescanOk = false;
        setStatusError(
          error instanceof Error
            ? error.message
            : "Could not rescan tracked directories",
        );
      }
    }
    const statusOk = await refreshStatus("full");
    if (!rescanOk || !statusOk) {
      setRefreshPhase("idle");
      return;
    }
    setRefreshPhase("success");
    refreshFeedbackTimerRef.current = setTimeout(() => {
      setRefreshPhase("idle");
      refreshFeedbackTimerRef.current = null;
    }, 1200);
  }, [baseUrl, refreshPhase, refreshStatus, token]);

  useEffect(() => {
    return () => {
      if (refreshFeedbackTimerRef.current) {
        clearTimeout(refreshFeedbackTimerRef.current);
      }
    };
  }, []);

  const refreshProfiles = useCallback(async (path: string = projectPath) => {
    if (!baseUrl) {
      return;
    }
    try {
      const next = await fetchProfiles(baseUrl, path || undefined);
      setProfiles(next);
      setProfilesError(null);
    } catch (error) {
      setProfilesError(
        error instanceof Error ? error.message : "Could not list profiles",
      );
    }
  }, [baseUrl, projectPath]);

  const refreshStash = useCallback(async () => {
    if (!baseUrl) {
      return;
    }
    try {
      const next = await fetchProfileStash(baseUrl, token);
      setStashEntries(next.entries);
    } catch {
      setStashEntries([]);
    }
  }, [baseUrl, token]);

  const refreshCloudAuth = useCallback(async () => {
    if (!baseUrl || !token) {
      setCloudAuth(null);
      return;
    }
    try {
      setCloudAuth(await fetchCloudAuthStatus(baseUrl, token));
    } catch {
      // Keep last known auth state; panel can retry on open.
    }
  }, [baseUrl, token]);

  const visibleProfiles = useMemo(() => {
    const scoped = profiles.filter(
      (profile) => profile.scopes.includes(view) && profile.name !== "empty",
    );
    const orderedNames = applyProfileRailOrder(
      scoped.map((profile) => profile.name),
      profileRailOrder[view],
    );
    const byName = new Map(scoped.map((profile) => [profile.name, profile]));
    return orderedNames.flatMap((name) => {
      const profile = byName.get(name);
      return profile ? [profile] : [];
    });
  }, [profileRailOrder, profiles, view]);

  const filteredProfiles = useMemo(
    () => filterProfilesByQuery(visibleProfiles, profileFilter),
    [profileFilter, visibleProfiles],
  );

  const canReorderProfiles =
    connected && !switching && profileFilter.trim() === "";

  const clearProfileSelection = useCallback(() => {
    setPreferEmptySelection(true);
    setSelectedProfile(null);
    setEditingProfile(null);
  }, []);

  const selectProfile = useCallback((name: string) => {
    setPreferEmptySelection(false);
    setSelectedProfile(name);
    setEditingProfile((current) => (current ? name : null));
  }, []);

  const persistProfileRailOrder = useCallback(
    (fromName: string, toName: string | null, placeAfter: boolean) => {
      const names = visibleProfiles.map((profile) => profile.name);
      const fromIndex = names.indexOf(fromName);
      if (fromIndex < 0) {
        return;
      }
      let insertBeforeIndex = names.length;
      if (toName !== null) {
        const targetIndex = names.indexOf(toName);
        if (targetIndex < 0) {
          return;
        }
        insertBeforeIndex = insertBeforeIndexForDrop(targetIndex, placeAfter);
      }
      const nextNames = reorderProfileNames(names, fromIndex, insertBeforeIndex);
      if (nextNames.every((name, index) => name === names[index])) {
        return;
      }
      setProfileRailOrder(saveProfileRailOrder(view, nextNames));
    },
    [view, visibleProfiles],
  );

  const onProfileDragStart = useCallback(
    (event: DragEvent<HTMLElement>, name: string) => {
      if (!canReorderProfiles) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/plain", name);
      event.dataTransfer.effectAllowed = "move";
      setDraggingProfile(name);
      setDropTarget(null);
    },
    [canReorderProfiles],
  );

  const onProfileDragEnd = useCallback(() => {
    if (draggingProfile) {
      skipProfileClickRef.current = true;
    }
    setDraggingProfile(null);
    setDropTarget(null);
  }, [draggingProfile]);

  const onProfileRowDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, name: string) => {
      if (!canReorderProfiles || !draggingProfile || draggingProfile === name) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      setDropTarget((current) => {
        if (
          current !== "end"
          && current?.name === name
          && current.placeAfter === placeAfter
        ) {
          return current;
        }
        return { name, placeAfter };
      });
    },
    [canReorderProfiles, draggingProfile],
  );

  const onProfileRowDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, name: string) => {
      if (!canReorderProfiles) {
        return;
      }
      event.preventDefault();
      const fromName =
        draggingProfile || event.dataTransfer.getData("text/plain");
      const rect = event.currentTarget.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      persistProfileRailOrder(fromName, name, placeAfter);
      skipProfileClickRef.current = true;
      setDraggingProfile(null);
      setDropTarget(null);
    },
    [canReorderProfiles, draggingProfile, persistProfileRailOrder],
  );

  const onProfileListDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!canReorderProfiles || !draggingProfile) {
        return;
      }
      if ((event.target as HTMLElement).closest(".profile-item")) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget("end");
    },
    [canReorderProfiles, draggingProfile],
  );

  const onProfileListDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!canReorderProfiles || !draggingProfile) {
        return;
      }
      if ((event.target as HTMLElement).closest(".profile-item")) {
        return;
      }
      event.preventDefault();
      persistProfileRailOrder(draggingProfile, null, true);
      skipProfileClickRef.current = true;
      setDraggingProfile(null);
      setDropTarget(null);
    },
    [canReorderProfiles, draggingProfile, persistProfileRailOrder],
  );

  const openEditProfile = useCallback((name: string) => {
    setPreferEmptySelection(false);
    setSelectedProfile(name);
    setWorkspaceFocus("scope");
    setEditingProfile(name);
  }, []);

  const closeEditProfile = useCallback(() => {
    setEditingProfile(null);
  }, []);

  const handleProfileDeleted = useCallback(
    (
      result?: { plugin_name: string; plugin_deleted: boolean },
      message?: string,
    ) => {
      clearProfileSelection();
      void refreshProfiles();
      void refreshStatus("full");
      if (message) {
        setSuccessMessage(message);
        window.setTimeout(() => setSuccessMessage(null), 3000);
      } else if (result?.plugin_name) {
        setSuccessMessage(
          result.plugin_deleted
            ? `Removed profile ${result.plugin_name} and deleted the plugin`
            : `Removed profile ${result.plugin_name}`,
        );
        window.setTimeout(() => setSuccessMessage(null), 3000);
      }
    },
    [clearProfileSelection, refreshProfiles, refreshStatus],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const connection = await connectAgent();
        if (cancelled) {
          return;
        }
        setBaseUrl(connection.baseUrl);
        setToken(connection.token);
        setFirstRun(Boolean(connection.health.first_run));
        setConnected(true);
        setConnectionError(null);
      } catch (error) {
        if (!cancelled) {
          setConnectionError(
            error instanceof Error ? error.message : "Sidecar connection failed",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const retryConnection = useCallback(async () => {
    if (retryBusy) {
      return;
    }
    setRetryBusy(true);
    setConnectionError(null);
    setConnected(false);
    try {
      const connection = await connectAgent({ restart: true });
      setBaseUrl(connection.baseUrl);
      setToken(connection.token);
      setFirstRun(Boolean(connection.health.first_run));
      setConnected(true);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "Sidecar connection failed",
      );
    } finally {
      setRetryBusy(false);
    }
  }, [retryBusy]);

  // Sidecar watcher rebuilds ht-agent in place; reconnect so previews use new code.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<number>("sidecar-reloaded", () => {
      if (cancelled) {
        return;
      }
      void (async () => {
        try {
          const connection = await connectAgent();
          if (cancelled) {
            return;
          }
          setBaseUrl(connection.baseUrl);
          setToken(connection.token);
          setFirstRun(Boolean(connection.health.first_run));
          setConnected(true);
          setConnectionError(null);
        } catch (error) {
          if (!cancelled) {
            setConnectionError(
              error instanceof Error
                ? error.message
                : "Sidecar reconnect after reload failed",
            );
            setConnected(false);
          }
        }
      })();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!connected || !baseUrl) {
      return;
    }
    setHasFullHarnessSnapshot(false);
    void refreshProfiles();
    void refreshStatus("full");
    void refreshCloudAuth();
    void refreshStash();
  }, [connected, baseUrl, projectPath, refreshProfiles, refreshStatus, refreshCloudAuth, refreshStash]);

  useEffect(() => {
    if (!baseUrl || !selectedProfile || switching) {
      setApplyPreview(null);
      setApplyPreviewError(null);
      setApplyPreviewLoading(false);
      return;
    }
    if (view === "project" && !projectPath) {
      setApplyPreview(null);
      setApplyPreviewError("Choose a project directory to preview project apply.");
      setApplyPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setApplyPreview(null);
    setApplyPreviewLoading(true);
    setApplyPreviewError(null);
    void (async () => {
      try {
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: selectedProfile,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        if (!cancelled) {
          setApplyPreview(preview);
          setApplyPreviewLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setApplyPreview(null);
          setApplyPreviewError(
            error instanceof Error
              ? error.message
              : "Could not preview profile apply",
          );
          setApplyPreviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    baseUrl,
    projectPath,
    selectedProfile,
    // Intentionally omit status.as_of — fast polls refresh it every few seconds
    // and were re-triggering this effect (panel loading flash / twitch).
    // Post-switch refresh is covered by `switching` flipping back to false.
    switching,
    token,
    view,
    previewRetryKey,
  ]);

  const handleRecoveryAction = useCallback(
    async (action: RecoveryAction) => {
      if (!baseUrl || !selectedProfile || recoveryBusy) {
        return;
      }

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
            setApplyPreviewError(
              `Version "${chosenVersion}" is not available. Choose one of: ${action.versions.join(", ")}`,
            );
            return;
          }
        }
      }

      setRecoveryBusy(true);
      setApplyPreviewError(null);
      try {
        await runConstraintRecoveryAction(baseUrl, token, {
          root: selectedProfile,
          action,
          ...(chosenVersion ? { chosenVersion } : {}),
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: selectedProfile,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        setApplyPreview(preview);
        if (preview.warning) {
          setSuccessMessage(`Recovered: ${action.label}. Review remaining issues.`);
          window.setTimeout(() => setSuccessMessage(null), 3000);
        } else {
          setSuccessMessage(`Recovered: ${action.label}`);
          window.setTimeout(() => setSuccessMessage(null), 3000);
        }
        if (selectedProfile === activeProfile) {
          await refreshStatus("full");
        }
      } catch (error) {
        setApplyPreviewError(
          error instanceof Error
            ? error.message
            : "Could not run recovery action",
        );
      } finally {
        setRecoveryBusy(false);
      }
    },
    [
      activeProfile,
      baseUrl,
      projectPath,
      recoveryBusy,
      refreshStatus,
      selectedProfile,
      token,
      view,
    ],
  );

  const handleCommitManagedChanges = useCallback(async () => {
    if (!baseUrl || !selectedProfile || !applyPreview || committingManagedChanges) {
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
        await commitProfileResource(baseUrl, token, selectedProfile, {
          path,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
      }
      const preview = await fetchApplyPreview(baseUrl, token, {
        profile: selectedProfile,
        scope: view,
        ...(view === "project" && projectPath ? { projectPath } : {}),
      });
      setApplyPreview(preview);
      if (selectedProfile === activeProfile) {
        await refreshStatus("full");
      }
    } catch (error) {
      setAddResourceError(
        error instanceof Error
          ? error.message
          : "Could not commit live changes into profile",
      );
    } finally {
      setCommittingManagedChanges(false);
    }
  }, [
    activeProfile,
    applyPreview,
    baseUrl,
    committingManagedChanges,
    projectPath,
    refreshStatus,
    selectedProfile,
    token,
    view,
  ]);

  const refreshProfilePreview = useCallback(async () => {
    const previewProfile = selectedProfile ?? activeProfile;
    if (!baseUrl || !previewProfile) {
      return;
    }
    const preview = await fetchApplyPreview(baseUrl, token, {
      profile: previewProfile,
      scope: view,
      ...(view === "project" && projectPath ? { projectPath } : {}),
    });
    if (selectedProfile) {
      setApplyPreview(preview);
    }
    if (previewProfile === activeProfile) {
      await refreshStatus("full");
    }
  }, [
    activeProfile,
    baseUrl,
    projectPath,
    refreshStatus,
    selectedProfile,
    token,
    view,
  ]);

  const handleOpenResourceInEditor = useCallback(
    async (resource: ProfileContentsResource) => {
      if (!baseUrl || !token) {
        return;
      }
      setResourceActionError(null);
      try {
        const selector = resource.id ?? `${resource.type}:${resource.name}`;
        await openResourcePath(baseUrl, token, {
          selector,
          pathHint: resource.source ?? null,
        });
      } catch (error) {
        setResourceActionError(
          error instanceof Error ? error.message : "Could not open resource in editor",
        );
      }
    },
    [baseUrl, token],
  );

  const handleOpenFileChange = useCallback(
    async (change: DriftFileChange, absolutePath: string) => {
      if (!baseUrl || !token || fileChangeBusyPath) {
        return;
      }
      setFileChangeBusyPath(change.path);
      setFileChangeBusyAction("open");
      setResourceActionError(null);
      try {
        await openResourcePath(baseUrl, token, { path: absolutePath });
      } catch (error) {
        setResourceActionError(
          error instanceof Error ? error.message : "Could not open file in editor",
        );
      } finally {
        setFileChangeBusyPath(null);
        setFileChangeBusyAction(null);
      }
    },
    [baseUrl, fileChangeBusyPath, token],
  );

  const handleDiffFileChange = useCallback((change: DriftFileChange) => {
    setDiffFileChange(change);
  }, []);

  const handleAddFileChange = useCallback(
    async (change: DriftFileChange) => {
      const profileName = selectedProfile ?? activeProfile;
      if (!baseUrl || !profileName || fileChangeBusyPath) {
        return;
      }
      setFileChangeBusyPath(change.path);
      setFileChangeBusyAction("add");
      setResourceActionError(null);
      try {
        const scopeOpts = {
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        };
        if (change.type === "modified") {
          await commitProfileResource(baseUrl, token, profileName, {
            path: change.path,
            ...scopeOpts,
          });
        } else if (change.type === "added" && change.resource) {
          await addProfileResource(baseUrl, token, profileName, {
            resourceType: change.resource.type,
            resourceName: change.resource.name,
            ...scopeOpts,
          });
        } else {
          return;
        }
        await refreshProfilePreview();
      } catch (error) {
        setResourceActionError(
          error instanceof Error
            ? error.message
            : "Could not commit file change into profile",
        );
      } finally {
        setFileChangeBusyPath(null);
        setFileChangeBusyAction(null);
      }
    },
    [
      activeProfile,
      baseUrl,
      fileChangeBusyPath,
      projectPath,
      refreshProfilePreview,
      selectedProfile,
      token,
      view,
    ],
  );

  const executeDropFileChange = useCallback(
    async (change: DriftFileChange) => {
      const profileName = selectedProfile ?? activeProfile;
      if (!baseUrl || !profileName || fileChangeBusyPath) {
        return;
      }
      setFileChangeBusyPath(change.path);
      setFileChangeBusyAction("drop");
      setResourceActionError(null);
      try {
        const scopeOpts = {
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        };
        if (change.type === "modified") {
          await restoreProfileFile(baseUrl, token, profileName, {
            path: change.path,
            ...scopeOpts,
          });
        } else if (change.resource) {
          await removeProfileResource(baseUrl, token, profileName, {
            resourceType: change.resource.type,
            resourceName: change.resource.name,
          });
        } else {
          return;
        }
        await refreshProfilePreview();
      } catch (error) {
        setResourceActionError(
          error instanceof Error
            ? error.message
            : "Could not drop file change",
        );
      } finally {
        setFileChangeBusyPath(null);
        setFileChangeBusyAction(null);
      }
    },
    [
      activeProfile,
      baseUrl,
      fileChangeBusyPath,
      projectPath,
      refreshProfilePreview,
      selectedProfile,
      token,
      view,
    ],
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

  const handleAddAllResources = useCallback(async () => {
    if (!baseUrl || !activeProfile || addingAllResources) {
      return;
    }
    setAddingAllResources(true);
    setAddResourceError(null);
    try {
      await addAllProfileResources(baseUrl, token, activeProfile, {
        scope: view,
        ...(view === "project" && projectPath ? { projectPath } : {}),
      });
      const previewProfile =
        selectedProfile === activeProfile ? activeProfile : selectedProfile;
      if (previewProfile) {
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: previewProfile,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        if (selectedProfile === previewProfile) {
          setApplyPreview(preview);
        }
      }
      await refreshStatus("full");
    } catch (error) {
      setAddResourceError(
        error instanceof Error ? error.message : "Could not add all resources to profile",
      );
    } finally {
      setAddingAllResources(false);
    }
  }, [
    activeProfile,
    addingAllResources,
    baseUrl,
    projectPath,
    refreshStatus,
    selectedProfile,
    token,
    view,
  ]);

  const homeProfilePending =
    view === "home"
    && Boolean(activeProfile)
    && status?.drift_summary.global.status === "pending";

  useEffect(() => {
    if (visibleProfiles.length === 0) {
      if (selectedProfile !== null) {
        setSelectedProfile(null);
      }
      return;
    }
    if (selectedProfile === null) {
      if (preferEmptySelection) {
        return;
      }
      // Prefer the pending active profile so Apply + preview light up without an
      // extra click when status already says home needs apply.
      if (
        homeProfilePending
        && activeProfile
        && visibleProfiles.some((profile) => profile.name === activeProfile)
      ) {
        setSelectedProfile(activeProfile);
        return;
      }
      setSelectedProfile(visibleProfiles[0]?.name ?? null);
      return;
    }
    if (!visibleProfiles.some((profile) => profile.name === selectedProfile)) {
      setPreferEmptySelection(false);
      setSelectedProfile(visibleProfiles[0]?.name ?? null);
    }
  }, [
    activeProfile,
    homeProfilePending,
    preferEmptySelection,
    selectedProfile,
    visibleProfiles,
  ]);

  useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = [
      "pointerdown",
      "keydown",
      "scroll",
      "wheel",
      "touchstart",
    ] as const;
    for (const event of events) {
      document.addEventListener(event, markActivity, {
        passive: true,
        capture: true,
      });
    }
    window.addEventListener("focus", markActivity);
    return () => {
      for (const event of events) {
        document.removeEventListener(event, markActivity, { capture: true });
      }
      window.removeEventListener("focus", markActivity);
    };
  }, []);

  useEffect(() => {
    if (!connected || switching) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current < ACTIVITY_TTL_MS) {
        void refreshStatus("fast");
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [connected, switching, refreshStatus]);

  const selectedProfileSummary = useMemo(
    () => profiles.find((profile) => profile.name === selectedProfile) ?? null,
    [profiles, selectedProfile],
  );
  const selectedIsActive = Boolean(
    selectedProfile && selectedProfile === activeProfile,
  );
  const showReapply = shouldShowReapply({
    selectedProfile,
    activeProfile,
    applied: Boolean(status?.applied),
    view,
    globalDriftStatus: status?.drift_summary.global.status ?? "clean",
    projectDriftStatus: status?.drift_summary.project?.status,
  });
  const applyHelper = useMemo(() => {
    if (switching) {
      return null;
    }
    if (!selectedProfile) {
      return "Select a profile to apply";
    }
    if (showReapply) {
      return `Drift on ${formatView(view)} · re-apply to restore saved state`;
    }
    if (selectedProfile === activeProfile && status?.applied) {
      return `Already applied to ${formatView(view)}`;
    }
    return null;
  }, [
    activeProfile,
    selectedProfile,
    showReapply,
    status?.applied,
    switching,
    view,
  ]);
  const applyButtonTitle = useMemo(() => {
    if (showReapply && activeProfile) {
      return [
        `Re-apply ${activeProfile} to ${formatView(view)}.`,
        "Overwrites modified harness files, recreates missing ones, and removes extras so disk matches the saved profile.",
        "Hand edits in those paths cannot be restored.",
      ].join(" ");
    }
    if (!selectedProfile) {
      return "Select a profile to apply";
    }
    if (selectedProfile === activeProfile && status?.applied) {
      return `Already applied to ${formatView(view)}. Choose another profile, or wait until drift appears to re-apply.`;
    }
    return `Apply ${selectedProfile} to ${formatView(view)}. Writes the profile's saved harness files onto disk for this scope.`;
  }, [
    activeProfile,
    selectedProfile,
    showReapply,
    status?.applied,
    view,
  ]);
  const selectedProfileMetaTags = useMemo(() => {
    if (!selectedProfileSummary) {
      return [];
    }
    return selectedProfileSummary.tags.filter((tag) => tag !== "profile");
  }, [selectedProfileSummary]);

  const openCutForProfile = useCallback((name: string, version: string) => {
    setCutRows([
      {
        name,
        currentVersion: version,
        newVersion: version,
      },
    ]);
    setCutModalOpen(true);
  }, []);

  const handleCutConfirm = useCallback(async () => {
    if (!baseUrl || !token || cutBusy || cutRows.length === 0) {
      return;
    }
    setCutBusy(true);
    setSwitchError(null);
    try {
      for (const row of cutRows) {
        await cutProfile(baseUrl, token, row.name, row.newVersion.trim());
      }
      setCutModalOpen(false);
      await refreshProfiles();
      await refreshStatus("full");
      if (selectedProfile) {
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: selectedProfile,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        setApplyPreview(preview);
      }
      const cutNames = cutRows.map((row) => row.name).join(", ");
      setSuccessMessage(`Cut version for ${cutNames}`);
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : "Could not cut profile version",
      );
    } finally {
      setCutBusy(false);
    }
  }, [
    baseUrl,
    cutBusy,
    cutRows,
    projectPath,
    refreshProfiles,
    refreshStatus,
    selectedProfile,
    token,
    view,
  ]);

  const runSwitch = useCallback(
    async (
      confirmOwnedOverwrite = false,
      requestedProfile?: string,
    ) => {
      const targetProfile = requestedProfile ?? selectedProfile;
      if (!baseUrl || !targetProfile || !token) {
        return;
      }
      setSwitching(true);
      setSwitchEvents([]);
      setSwitchError(null);
      setSuccessMessage(null);
      try {
        const id = await startSwitch(baseUrl, token, {
          profile: targetProfile,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
          confirmOwnedOverwrite,
        });
        setSwitchId(id);
        subscribeSwitchEvents(
          baseUrl,
          id,
          (event) => {
            setSwitchEvents((current) => [...current, event]);
          },
          async (final) => {
            setSwitching(false);
            setSwitchId(null);
            await refreshStatus("full");
            if (!final.ok) {
              setSwitchError(
                final.cancelled
                  ? "Switch cancelled"
                  : final.error ?? "Switch failed",
              );
              return;
            }
            setSuccessMessage(
              `Applied ${targetProfile} to ${formatView(view)}`,
            );
            window.setTimeout(() => setSuccessMessage(null), 3000);
          },
          (message) => {
            setSwitching(false);
            setSwitchId(null);
            setSwitchError(message);
          },
        );
      } catch (error) {
        setSwitching(false);
        if (
          error instanceof AgentApiError
          && error.code === "owned_overwrite_confirmation_required"
          && !skipOverwritePrompt
        ) {
          setOverwriteDialog(true);
          return;
        }
        setSwitchError(
          error instanceof Error ? error.message : "Switch failed",
        );
      }
    },
    [
      baseUrl,
      projectPath,
      refreshStatus,
      selectedProfile,
      skipOverwritePrompt,
      token,
      view,
    ],
  );

  const maybeAutoReapplyAfterMutation = useCallback(
    async (input: { profileName: string; affectsApply: boolean }) => {
      const shouldReapply = shouldAutoReapply({
        mutatedProfile: input.profileName,
        activeProfile,
        applied: Boolean(status?.applied),
        view,
        preexistingGlobalDriftStatus:
          status?.drift_summary.global.status ?? "clean",
        preexistingProjectDriftStatus: status?.drift_summary.project?.status,
        affectsApply: input.affectsApply,
      });
      await refreshProfiles();
      if (input.profileName === selectedProfile || input.profileName === activeProfile) {
        await refreshStatus("full");
      }
      if (shouldReapply) {
        await runSwitch(true, input.profileName);
      }
    },
    [
      activeProfile,
      refreshProfiles,
      refreshStatus,
      runSwitch,
      selectedProfile,
      status?.applied,
      status?.drift_summary.global.status,
      status?.drift_summary.project?.status,
      view,
    ],
  );

  const handleAddResource = useCallback(
    async (resource: ProfileContentsResource, profileOverride?: string) => {
      const profileName = profileOverride ?? selectedProfile;
      if (!baseUrl || !profileName) {
        return;
      }
      const key = `${resource.type}:${resource.name}`;
      if (addingResourceKey) {
        return;
      }
      const preexisting = {
        globalDriftStatus:
          status?.drift_summary.global.status ?? ("clean" as const),
        projectDriftStatus: status?.drift_summary.project?.status,
        applied: Boolean(status?.applied),
        activeProfile,
      };
      setAddingResourceKey(key);
      setAddResourceError(null);
      try {
        await addProfileResource(baseUrl, token, profileName, {
          resourceType: resource.type,
          resourceName: resource.name,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: profileName,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        setApplyPreview(preview);
        if (
          shouldAutoReapply({
            mutatedProfile: profileName,
            activeProfile: preexisting.activeProfile,
            applied: preexisting.applied,
            view,
            preexistingGlobalDriftStatus: preexisting.globalDriftStatus,
            preexistingProjectDriftStatus: preexisting.projectDriftStatus,
            affectsApply: true,
          })
        ) {
          await runSwitch(true, profileName);
        } else if (profileName === activeProfile) {
          await refreshStatus("full");
        }
      } catch (error) {
        setAddResourceError(
          error instanceof Error ? error.message : "Could not add resource to profile",
        );
        if (profileOverride !== undefined) {
          throw error;
        }
      } finally {
        setAddingResourceKey(null);
      }
    },
    [
      activeProfile,
      addingResourceKey,
      baseUrl,
      projectPath,
      refreshStatus,
      runSwitch,
      selectedProfile,
      status?.applied,
      status?.drift_summary.global.status,
      status?.drift_summary.project?.status,
      token,
      view,
    ],
  );

  const handleRemoveResourceFromProfile = useCallback(
    async (resource: ProfileContentsResource, pluginId?: string) => {
      const profileName = selectedProfile ?? activeProfile;
      if (!baseUrl || !profileName || removingResourceKey) {
        return;
      }
      const key = `${resource.type}:${resource.name}`;
      const preexisting = {
        globalDriftStatus:
          status?.drift_summary.global.status ?? ("clean" as const),
        projectDriftStatus: status?.drift_summary.project?.status,
        applied: Boolean(status?.applied),
        activeProfile,
      };
      setRemovingResourceKey(key);
      setResourceActionError(null);
      try {
        await removeProfileResource(baseUrl, token, profileName, {
          resourceType: resource.type,
          resourceName: resource.name,
          ...(pluginId ? { pluginId } : {}),
        });
        await refreshProfilePreview();
        if (
          shouldAutoReapply({
            mutatedProfile: profileName,
            activeProfile: preexisting.activeProfile,
            applied: preexisting.applied,
            view,
            preexistingGlobalDriftStatus: preexisting.globalDriftStatus,
            preexistingProjectDriftStatus: preexisting.projectDriftStatus,
            affectsApply: true,
          })
        ) {
          await runSwitch(true, profileName);
        }
      } catch (error) {
        setResourceActionError(
          error instanceof Error
            ? error.message
            : "Could not remove resource from profile",
        );
      } finally {
        setRemovingResourceKey(null);
      }
    },
    [
      activeProfile,
      baseUrl,
      refreshProfilePreview,
      removingResourceKey,
      runSwitch,
      selectedProfile,
      status?.applied,
      status?.drift_summary.global.status,
      status?.drift_summary.project?.status,
      token,
      view,
    ],
  );

  const onProfileCreated = useCallback(
    async (profileName: string, shouldSwitch: boolean) => {
      await refreshProfiles();
      selectProfile(profileName);
      if (shouldSwitch) {
        await runSwitch(false, profileName);
      }
    },
    [refreshProfiles, runSwitch, selectProfile],
  );

  const onStashProfile = useCallback(async () => {
    if (!baseUrl || !token || stashBusy || switching) {
      return;
    }
    setStashBusy(true);
    setStashAction("stash");
    setSwitchError(null);
    try {
      const result = await stashActiveProfile(baseUrl, token);
      await refreshStatus("full");
      await refreshStash();
      if (activeProfile && selectedProfile === activeProfile) {
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: activeProfile,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
        setApplyPreview(preview);
      }
      setSuccessMessage(
        `Stashed ${result.entry.contents.resources.length} untracked resource${result.entry.contents.resources.length === 1 ? "" : "s"}`,
      );
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : "Could not stash profile",
      );
    } finally {
      setStashBusy(false);
      setStashAction(null);
    }
  }, [
    activeProfile,
    baseUrl,
    projectPath,
    refreshStatus,
    refreshStash,
    selectedProfile,
    stashBusy,
    switching,
    token,
    view,
  ]);

  const onUnstashProfile = useCallback(async () => {
    if (!baseUrl || !token || stashBusy || switching || stashEntries.length === 0) {
      return;
    }
    setStashBusy(true);
    setStashAction("unstash");
    setSwitchError(null);
    try {
      const result = await popProfileStash(baseUrl, token);
      if (result.restored.cancelled) {
        setSwitchError("Restore cancelled");
        return;
      }
      selectProfile(result.entry.profile_name);
      await refreshProfiles();
      await refreshStatus("full");
      await refreshStash();
      setSuccessMessage(
        `Restored ${result.entry.contents.resources.length} untracked resource${result.entry.contents.resources.length === 1 ? "" : "s"}`,
      );
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : "Could not restore stashed profile",
      );
    } finally {
      setStashBusy(false);
      setStashAction(null);
    }
  }, [
    baseUrl,
    refreshProfiles,
    refreshStatus,
    refreshStash,
    selectProfile,
    stashBusy,
    stashEntries.length,
    switching,
    token,
  ]);

  const ensureProjectReady = useCallback(
    async (pathOverride?: string): Promise<boolean> => {
      const path = (pathOverride ?? projectPath).trim();
      if (!baseUrl || !token || !path) {
        return false;
      }
      const alreadyReady =
        path === projectPath
          ? projectReady
          : projectConfigReadyPath === path;
      if (alreadyReady) {
        return true;
      }
      setBootstrapBusy(true);
      setBootstrapError(null);
      try {
        // Init only when config is missing; agent bootstrap is idempotent if present.
        await bootstrapProject(baseUrl, token, { projectPath: path });
        setProjectConfigReadyPath(path);
        await refreshProfiles(path);
        await refreshStatus("full", path);
        return true;
      } catch (error) {
        setBootstrapError(
          error instanceof Error ? error.message : "Project setup failed",
        );
        return false;
      } finally {
        setBootstrapBusy(false);
      }
    },
    [
      baseUrl,
      projectConfigReadyPath,
      projectPath,
      projectReady,
      refreshProfiles,
      refreshStatus,
      token,
    ],
  );

  const onSelectView = (next: ViewScope) => {
    setWorkspaceFocus("scope");
    if (next === "home") {
      setView("home");
      return;
    }
    void (async () => {
      let path = projectPath;
      if (!path) {
        try {
          const selected = await open({
            directory: true,
            multiple: false,
            title: "Select project directory",
          });
          if (typeof selected !== "string" || selected.length === 0) {
            return;
          }
          selectProject(selected);
          path = selected;
        } catch (error) {
          setStatusError(
            error instanceof Error
              ? error.message
              : "Could not open folder picker",
          );
          return;
        }
      }
      const ready = await ensureProjectReady(path);
      if (ready) {
        setView("project");
      }
    })();
  };

  const activeDestination = activeHeaderDestination(workspaceFocus, view);
  const canWorkspaceBack = canPopScreenHistory(screenHistory);
  const scopeCanGoBack = Boolean(editingProfile) || canWorkspaceBack;

  const applyHeaderDestination = (clicked: HeaderDestination): void => {
    switch (clicked) {
      case "library":
        setEditingProfile(null);
        setWorkspaceFocus("library");
        return;
      case "sources":
        setEditingProfile(null);
        setWorkspaceFocus("sources");
        return;
      case "environments":
        setEditingProfile(null);
        setWorkspaceFocus("environments");
        return;
      case "home":
        onSelectView("home");
        return;
      case "project":
        onSelectView("project");
        return;
      default: {
        const neverClicked: never = clicked;
        return neverClicked;
      }
    }
  };

  const navigateToDestination = (next: HeaderDestination): void => {
    setScreenHistory((stack) =>
      pushScreenHistory(stack, activeDestination, next),
    );
    applyHeaderDestination(next);
  };

  const onWorkspaceBack = (): void => {
    const { stack, previous } = popScreenHistory(screenHistory);
    if (!previous) {
      return;
    }
    setScreenHistory(stack);
    applyHeaderDestination(previous);
  };

  const onHeaderDestinationClick = (clicked: HeaderDestination): void => {
    if (headerClickIntent(activeDestination, clicked) === "reset") {
      switch (clicked) {
        case "library":
        case "sources":
        case "environments":
          setHomeResetNonce((value) => value + 1);
          return;
        case "home":
        case "project":
          setProfileFilter("");
          setEditingProfile(null);
          return;
        default: {
          const neverClicked: never = clicked;
          return neverClicked;
        }
      }
    }
    navigateToDestination(clicked);
  };

  const onApplyClick = () => {
    if (showReapply) {
      if (!activeProfile) {
        return;
      }
      setReapplyConfirmOpen(true);
      return;
    }
    void runSwitch(false);
  };

  const onConfirmReapply = () => {
    if (!activeProfile) {
      return;
    }
    setReapplyConfirmOpen(false);
    void runSwitch(false, activeProfile);
  };

  const openCreateProfile = (
    source: ProfileCreateSource = "compose",
    switchAfterCreate = false,
  ) => {
    setCreateProfileInitialSource(source);
    setCreateProfileInitialSwitchAfterCreate(switchAfterCreate);
    setCreateProfileOpen(true);
  };

  const onPendingHomeApply = () => {
    if (!activeProfile) {
      return;
    }
    selectProfile(activeProfile);
    void runSwitch(false, activeProfile);
  };

  const beginRenameSelectedProfile = () => {
    if (!selectedProfile || !connected || switching || renameBusy) {
      return;
    }
    renameIgnoreBlurRef.current = false;
    setRenameDraft(selectedProfile);
    setRenameError(null);
    setRenamingProfile(true);
  };

  const cancelRenameSelectedProfile = () => {
    renameIgnoreBlurRef.current = true;
    setRenamingProfile(false);
    setRenameDraft("");
    setRenameError(null);
  };

  const commitRenameSelectedProfile = async () => {
    if (!baseUrl || !selectedProfile || renameBusy || renameIgnoreBlurRef.current) {
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
      const result = await renameProfile(baseUrl, token, selectedProfile, nextName);
      setSelectedProfile(result.name);
      renameIgnoreBlurRef.current = true;
      setRenamingProfile(false);
      setRenameDraft("");
      await Promise.all([refreshProfiles(), refreshStatus("full")]);
      setSuccessMessage(`Renamed to ${result.name}`);
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      if (error instanceof AgentApiError && error.code === "plugin_exists") {
        setRenameError("A profile with this name already exists.");
      } else if (error instanceof AgentApiError && error.code === "not_found") {
        setRenameError(
          "Rename is unavailable — restart the desktop app to reload the sidecar.",
        );
      } else {
        setRenameError(
          error instanceof Error ? error.message : "Could not rename profile",
        );
      }
      window.setTimeout(() => renameInputRef.current?.focus(), 0);
    } finally {
      setRenameBusy(false);
    }
  };

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
  }, [selectedProfile, renamingProfile, switching]);

  const onConfirmOverwrite = () => {
    setOverwriteDialog(false);
    void runSwitch(true, showReapply ? activeProfile ?? undefined : undefined);
  };

  const onConfirmRestoreFile = () => {
    const change = pendingRestoreChange;
    setPendingRestoreChange(null);
    if (!change) {
      return;
    }
    void executeDropFileChange(change);
  };

  const onCancelSwitch = async () => {
    if (!baseUrl || !token || !switchId) {
      return;
    }
    try {
      await cancelSwitch(baseUrl, token, switchId);
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : "Could not cancel switch",
      );
    }
  };

  const applyDisabled =
    !connected
    || switching
    || pluginApplyBusy
    || bootstrapBusy
    || (view === "project" && (!projectPath || !projectReady))
    || (showReapply
      ? !activeProfile
      : !selectedProfile
        || (selectedProfile === activeProfile && Boolean(status?.applied)));

  return (
    <Tooltip.Provider delayDuration={400}>
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <h1>HarnessTap</h1>
        </div>
        <div className="header-focus" role="group" aria-label="Workspace">
          <div className="header-focus-controls">
            <button
              type="button"
              className={`header-focus-btn labeled${workspaceFocus === "library" ? " on" : ""}`}
              onClick={() => onHeaderDestinationClick("library")}
              disabled={switching}
              aria-label="Library"
              title="Library"
            >
              <Library size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              Library
            </button>
            <button
              type="button"
              className={`header-focus-btn labeled${workspaceFocus === "sources" ? " on" : ""}`}
              onClick={() => onHeaderDestinationClick("sources")}
              disabled={switching}
              aria-label="Sources"
              title="Sources"
            >
              <PackageSearch size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              Sources
            </button>
            <ParityChrome
              workspaceFocus={workspaceFocus}
              onWorkspaceFocus={() => {
                onHeaderDestinationClick("environments");
              }}
              switching={switching}
            />
            <div
              className="header-focus-segment"
              role="group"
              aria-label="Scope"
            >
              <button
                type="button"
                className={
                  workspaceFocus === "scope" && view === "home" ? "on" : ""
                }
                data-testid="view-home"
                onClick={() => onHeaderDestinationClick("home")}
                disabled={switching || bootstrapBusy}
                aria-label="Global"
                title="Global"
              >
                <Globe size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                Global
              </button>
              <button
                type="button"
                className={
                  workspaceFocus === "scope" && view === "project" ? "on" : ""
                }
                data-testid="view-project"
                onClick={() => onHeaderDestinationClick("project")}
                disabled={switching || bootstrapBusy}
                aria-label="Project"
                title={
                  !projectPath
                    ? "Choose a project directory"
                    : !projectReady
                      ? "Sets up this repo as a HarnessTap project on first use"
                      : "Project"
                }
              >
                <FolderGit2 size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                Project
              </button>
            </div>
          </div>
          {workspaceFocus === "scope" && view === "project" ? (
            <div className="header-project-row">
              <ProjectPicker
                projectPath={projectPath}
                disabled={switching}
                onSelect={selectProject}
                onBrowse={() => void browseProject()}
              />
              {projectPath ? (
                <ProjectHistoryControl
                  baseUrl={baseUrl}
                  token={token}
                  connected={connected}
                  switching={switching}
                  projectPath={projectPath}
                  onSuccess={(message) => {
                    setSuccessMessage(message);
                    window.setTimeout(() => setSuccessMessage(null), 3000);
                  }}
                  onProfilesChanged={() => {
                    void refreshProfiles();
                    void refreshStatus("full");
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="header-focus-spacer" aria-hidden />
          )}
        </div>
        <div
          className="header-status"
          data-testid={connected ? "agent-connected" : undefined}
        >
          {successMessage ? (
            <div className="success-flash">{successMessage}</div>
          ) : null}
          <button
            className={[
              "icon-action",
              "refresh-action",
              refreshPhase === "loading" ? "is-loading" : "",
              refreshPhase === "success" ? "is-success" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            data-testid="header-refresh"
            onClick={() => void onRefreshClick()}
            disabled={!connected || switching || refreshPhase === "loading"}
            aria-busy={refreshPhase === "loading"}
            aria-label={
              refreshPhase === "success"
                ? "Refreshed"
                : refreshPhase === "loading"
                  ? "Refreshing"
                  : "Refresh live status and rescan tracked directories"
            }
            title={
              refreshPhase === "loading"
                ? "Refreshing live status and rescanning tracked directories…"
                : lastUpdated
                  ? `Refresh live status and rescan tracked directories. Last updated: ${lastUpdated}`
                  : "Refresh live status and rescan tracked directories"
            }
          >
            {refreshPhase === "success" ? (
              <Check size={HEADER_ICON_SIZE} strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <RefreshCw
                className="refresh-spinner"
                size={HEADER_ICON_SIZE}
                strokeWidth={2}
                aria-hidden="true"
              />
            )}
          </button>
          <button
            className="icon-action"
            type="button"
            data-testid="open-migrate-export"
            onClick={() => {
              setCreateProfileOpen(false);
              setStashBrowseOpen(false);
              setCloudAccountOpen(false);
              setSettingsOpen(false);
              setMigrateImportOpen(false);
              setMigrateExportOpen(true);
            }}
            disabled={!connected || switching || migrateBusy}
            aria-label="Export"
            title="Export"
          >
            <Upload size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            className="icon-action"
            type="button"
            data-testid="open-migrate-import"
            onClick={() => {
              setCreateProfileOpen(false);
              setStashBrowseOpen(false);
              setCloudAccountOpen(false);
              setSettingsOpen(false);
              setMigrateExportOpen(false);
              setMigrateImportOpen(true);
            }}
            disabled={!connected || switching || migrateBusy}
            aria-label="Import"
            title="Import"
          >
            <Download size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            className="icon-action"
            type="button"
            data-testid="open-settings"
            onClick={() => {
              setCloudAccountOpen(false);
              setMigrateExportOpen(false);
              setMigrateImportOpen(false);
              setSettingsOpen(true);
            }}
            disabled={!connected}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            className={[
              "icon-action",
              "account-action",
              cloudAuth?.authenticated ? "is-signed-in" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setCloudAccountOpen(true);
            }}
            disabled={!connected}
            aria-label={
              cloudAuth?.authenticated
                ? `Cloud account${cloudAuth.email ? `: ${cloudAuth.email}` : ""}`
                : "Sign in to Cloud"
            }
            title={
              cloudAuth?.authenticated
                ? cloudAuth.email ?? cloudAuth.orgSlug ?? "Cloud account"
                : "Sign in to Cloud"
            }
          >
            <User size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>

      {!connected && (
        <div className="banner error" style={{ margin: "0.75rem 1rem" }}>
          <div>
            {connectionError
              ?? "Waiting for sidecar health check on 127.0.0.1:7474…"}
          </div>
          <button
            className={["btn", retryBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
            type="button"
            onClick={() => void retryConnection()}
            disabled={retryBusy}
            aria-busy={retryBusy}
          >
            {retryBusy ? <ButtonSpinner size={16} /> : null}
            {retryBusy ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      <div className={`layout${workspaceFocus === "scope" ? "" : " resources-focus"}`}>
        {workspaceFocus === "scope" ? (
        <nav className="profiles-rail" aria-label="Profiles">
          <div className="profiles-brand">
            <div className="resources-panel-title-cluster">
              <WorkspaceBackButton
                disabled={switching || !scopeCanGoBack}
                onClick={() => {
                  if (editingProfile) {
                    closeEditProfile();
                    return;
                  }
                  onWorkspaceBack();
                }}
              />
              <span>Profiles</span>
            </div>
            <div className="profiles-brand-actions">
              <div className="profiles-rail-toolbar">
                <button
                  className={[
                    "icon-action",
                    "rail-icon-action",
                    stashAction === "stash" ? "is-busy" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() => void onStashProfile()}
                  disabled={
                    !connected
                    || !token
                    || switching
                    || stashBusy
                    || !canStashProfile
                  }
                  aria-busy={stashAction === "stash"}
                  aria-label={
                    canStashProfile
                      ? `Stash not-staged resources for ${activeProfile}`
                      : "Stash not-staged resources"
                  }
                  title={
                    canStashProfile
                      ? `Stash ${status?.untracked_resource_count ?? 0} not-staged resource${(status?.untracked_resource_count ?? 0) === 1 ? "" : "s"}`
                      : stashDisabledReason ?? "Stash not-staged resources"
                  }
                >
                  {stashAction === "stash" ? (
                    <ButtonSpinner size={RAIL_ICON_SIZE} />
                  ) : (
                    <Archive size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
                <button
                  className={[
                    "icon-action",
                    "rail-icon-action",
                    stashAction === "unstash" ? "is-busy" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() => void onUnstashProfile()}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!canUnstashProfile || !connected || switching || stashBusy) {
                      return;
                    }
                    setStashBrowseOpen(true);
                  }}
                  disabled={
                    !connected
                    || !token
                    || switching
                    || stashBusy
                    || !canUnstashProfile
                  }
                  aria-busy={stashAction === "unstash"}
                  aria-label={
                    canUnstashProfile && topStashEntry
                      ? `Restore stashed untracked resources from ${topStashEntry.profile_name}`
                      : "Restore stashed untracked resources"
                  }
                  title={
                    canUnstashProfile && topStashEntry
                      ? `Restore ${topStashEntry.contents.resources.length} untracked resource${topStashEntry.contents.resources.length === 1 ? "" : "s"} · right-click to browse`
                      : "No stashed untracked resources to restore"
                  }
                >
                  {stashAction === "unstash" ? (
                    <ButtonSpinner size={RAIL_ICON_SIZE} />
                  ) : (
                    <ArchiveRestore size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
                <button
                  className="icon-action rail-icon-action"
                  type="button"
                  data-testid="open-create-profile"
                  onClick={() => openCreateProfile()}
                  disabled={!connected || switching || stashBusy}
                  aria-label="Create profile"
                  title="Create profile"
                >
                  <Plus size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div className="profiles-filter-row">
            <input
              className="profiles-filter"
              type="search"
              placeholder="Filter profiles…"
              value={profileFilter}
              onChange={(event) => setProfileFilter(event.target.value)}
              disabled={!connected || switching || visibleProfiles.length === 0}
              aria-label="Filter profiles by name, description, or tags"
            />
            {selectedProfile ? (
              <button
                className="rail-clear-button"
                type="button"
                onClick={clearProfileSelection}
                disabled={switching}
                title="Clear profile selection"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div
            className={[
              "profiles-list",
              dropTarget === "end" ? "drop-target-end" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onDragOver={onProfileListDragOver}
            onDrop={onProfileListDrop}
          >
            {profilesError && (
              <div className="empty-state">
                <p>{profilesError}</p>
                <button className="btn" type="button" onClick={() => void refreshProfiles()}>
                  Retry
                </button>
              </div>
            )}
            {!profilesError && visibleProfiles.length === 0 && (
              <div className="empty-state">
                <h2>
                  {profiles.length === 0
                    ? "No profiles yet"
                    : view === "project"
                      ? "No project profiles"
                      : "No global profiles"}
                </h2>
                <p className="muted">
                  {profiles.length === 0 ? (
                    <>
                      Waiting for the sidecar to seed a default profile…
                    </>
                  ) : view === "project" ? (
                    <>
                      Profiles listed in this project&apos;s{" "}
                      <span className="mono">.harnesstap/config.toml</span> appear in
                      Project view. Global-only profiles stay in Global.
                    </>
                  ) : (
                    <>
                      Local profile plugins appear in Global. Switch to Project for
                      profiles enabled in the current project.
                    </>
                  )}
                </p>
                <button
                  className="btn primary"
                  type="button"
                  data-testid="open-create-profile"
                  onClick={() => openCreateProfile()}
                  disabled={!connected || switching}
                >
                  Create profile
                </button>
              </div>
            )}
            {!profilesError
              && visibleProfiles.length > 0
              && filteredProfiles.length === 0 && (
              <div className="empty-state">
                <h2>No matching profiles</h2>
                <p className="muted">
                  No profiles match “{profileFilter.trim()}”. Try a different
                  name, description, or tag.
                </p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setProfileFilter("")}
                >
                  Clear filter
                </button>
              </div>
            )}
            {filteredProfiles.map((profile) => {
              const isActive = profile.name === activeProfile;
              const isSelected = profile.name === selectedProfile;
              const showAddAll = isActive && activeProfileUntrackedCount > 0;
              const isDragging = draggingProfile === profile.name;
              const isDropBefore =
                dropTarget !== "end"
                && dropTarget?.name === profile.name
                && !dropTarget.placeAfter;
              const isDropAfter =
                dropTarget !== "end"
                && dropTarget?.name === profile.name
                && dropTarget.placeAfter;
              return (
                <div
                  key={profile.name}
                  className={[
                    "profile-item",
                    isActive ? "active" : "",
                    isSelected ? "selected" : "",
                    isDragging ? "dragging" : "",
                    isDropBefore ? "drop-target-before" : "",
                    isDropAfter ? "drop-target-after" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={canReorderProfiles}
                  aria-grabbed={isDragging}
                  onDragStart={(event) => onProfileDragStart(event, profile.name)}
                  onDragOver={(event) => onProfileRowDragOver(event, profile.name)}
                  onDrop={(event) => onProfileRowDrop(event, profile.name)}
                  onDragEnd={onProfileDragEnd}
                >
                  <button
                    type="button"
                    className="profile-item-main"
                    data-testid={`profile-rail-${profile.name}`}
                    draggable={canReorderProfiles}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      onProfileDragStart(event, profile.name);
                    }}
                    onClick={() => {
                      if (skipProfileClickRef.current) {
                        skipProfileClickRef.current = false;
                        return;
                      }
                      if (isSelected) {
                        clearProfileSelection();
                        return;
                      }
                      selectProfile(profile.name);
                    }}
                    disabled={switching}
                  >
                    {profile.name}
                    {isActive ? <span className="badge">active</span> : null}
                  </button>
                  <button
                    type="button"
                    className="icon-action profile-item-action profile-item-edit"
                    data-testid={`edit-profile-${profile.name}`}
                    aria-label={`Edit ${profile.name}`}
                    title={`Edit ${profile.name}`}
                    draggable={false}
                    onDragStart={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    disabled={!connected || switching || stashBusy}
                    onClick={() => openEditProfile(profile.name)}
                  >
                    <Pencil size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                  </button>
                  {showAddAll ? (
                    <button
                      type="button"
                      className={[
                        "icon-action",
                        "profile-item-action",
                        addingAllResources ? "is-busy" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={`Commit ${activeProfileUntrackedCount} not-staged resources into profile`}
                      title={`Commit all ${activeProfileUntrackedCount} not-staged resources into profile`}
                      aria-busy={addingAllResources}
                      draggable={false}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      disabled={
                        !connected
                        || !token
                        || switching
                        || addingAllResources
                        || stashBusy
                      }
                      onClick={() => {
                        void handleAddAllResources();
                      }}
                    >
                      {addingAllResources ? (
                        <ButtonSpinner size={RAIL_ICON_SIZE} />
                      ) : (
                        <Plus size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="rail-controls">
            {applyHelper ? <p className="muted apply-helper">{applyHelper}</p> : null}
            <button
              className={["btn", "primary", switching ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={onApplyClick}
              disabled={applyDisabled}
              aria-busy={switching}
              title={applyButtonTitle}
              aria-label={
                showReapply
                  ? `Re-apply ${activeProfile ?? "profile"} to ${formatView(view)}`
                  : selectedProfile
                    ? `Apply ${selectedProfile} to ${formatView(view)}`
                    : "Apply profile"
              }
            >
              {switching ? <ButtonSpinner size={16} /> : null}
              {switching ? "Applying…" : showReapply ? "Re-apply" : "Apply"}
            </button>
          </div>
        </nav>
        ) : null}

        {workspaceFocus === "environments" ? (
          <EnvironmentsWorkspace
            baseUrl={baseUrl}
            token={token}
            projectPath={view === "project" ? projectPath : null}
            disabled={switching}
            homeResetNonce={homeResetNonce}
            onOpenPlugin={(pluginName) => {
              setLibraryFocusPlugin(pluginName);
              navigateToDestination("library");
            }}
            canWorkspaceBack={canWorkspaceBack}
            onWorkspaceBack={onWorkspaceBack}
            onSuccess={(message) => {
              setSuccessMessage(message);
              window.setTimeout(() => setSuccessMessage(null), 3000);
            }}
          />
        ) : workspaceFocus === "sources" ? (
          <SourcesWorkspace
            baseUrl={baseUrl}
            token={token}
            disabled={switching}
            homeResetNonce={homeResetNonce}
            cloudAuthenticated={Boolean(cloudAuth?.authenticated)}
            onSignIn={() => setCloudAccountOpen(true)}
            canWorkspaceBack={canWorkspaceBack}
            onWorkspaceBack={onWorkspaceBack}
            onOpenInLibrary={(selector) => {
              if (selector.includes(":")) {
                setLibraryFocusResource(selector);
              } else {
                setLibraryFocusPlugin(selector);
              }
              setWorkspaceFocus("library");
            }}
            onSuccess={(message) => {
              setSuccessMessage(message);
              window.setTimeout(() => setSuccessMessage(null), 3000);
            }}
          />
        ) : workspaceFocus === "library" ? (
          <ResourcesPanel
            baseUrl={baseUrl}
            token={token}
            reloadKey={libraryReloadKey}
            disabled={switching}
            homeResetNonce={homeResetNonce}
            projectPath={view === "project" ? projectPath : null}
            selectedProfile={selectedProfile}
            attachProfileName={selectedProfile ?? activeProfile}
            onAddToProfile={(resource) =>
              handleAddResource(resource, selectedProfile ?? activeProfile ?? undefined)
            }
            focusPluginName={libraryFocusPlugin}
            onFocusPluginConsumed={() => setLibraryFocusPlugin(null)}
            focusResourceSelector={libraryFocusResource}
            onFocusResourceConsumed={() => setLibraryFocusResource(null)}
            onBusyChange={setPluginApplyBusy}
            canWorkspaceBack={canWorkspaceBack}
            onWorkspaceBack={onWorkspaceBack}
            autoOpenTrackedDirectories={firstRun}
            onProfilesChanged={() => {
              void refreshProfiles();
              void refreshStatus("full");
            }}
            onImported={(message) => {
              setSuccessMessage(message);
              window.setTimeout(() => setSuccessMessage(null), 3000);
              setLibraryReloadKey((value) => value + 1);
            }}
            onSuccess={(message) => {
              setSuccessMessage(message);
              window.setTimeout(() => setSuccessMessage(null), 3000);
            }}
          />
        ) : editingProfile ? (
          <EditProfilePane
            profileName={editingProfile}
            baseUrl={baseUrl}
            token={token}
            projectPath={view === "project" ? projectPath : null}
            disabled={switching}
            onClose={closeEditProfile}
            onProfileRenamed={(nextName) => {
              setSelectedProfile(nextName);
              setEditingProfile(nextName);
            }}
            onMutated={maybeAutoReapplyAfterMutation}
            onDeleted={handleProfileDeleted}
            onOpenEnvironments={() => {
              navigateToDestination("environments");
            }}
            onSuccess={(message) => {
              setSuccessMessage(message);
              window.setTimeout(() => setSuccessMessage(null), 3000);
            }}
            onRequestSignIn={() => setCloudAccountOpen(true)}
            onRequestCut={
              editingProfile && baseUrl && token
                ? (name, version) => openCutForProfile(name, version)
                : undefined
            }
          />
        ) : (
          <main className="live-pane" aria-label="Live state">
            {bootstrapError ? (
              <div className="banner error">
                <div>{bootstrapError}</div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setBootstrapError(null)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            <div className="live-toolbar">
              <div>
                <div className="status-line" aria-live="polite">
                  {selectedProfile ? (
                    <>
                      {renamingProfile ? (
                        <input
                          ref={renameInputRef}
                          className="status-title-input"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitRenameSelectedProfile();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRenameSelectedProfile();
                            }
                          }}
                          onBlur={() => {
                            if (!renameBusy) {
                              void commitRenameSelectedProfile();
                            }
                          }}
                          disabled={renameBusy}
                          aria-label="Rename selected profile"
                        />
                      ) : (
                        <button
                          type="button"
                          className="status-title"
                          onDoubleClick={beginRenameSelectedProfile}
                          disabled={!connected || switching}
                          title="Double-click to rename"
                        >
                          {selectedProfile}
                        </button>
                      )}
                      {selectedIsActive ? (
                        <span className="badge">active</span>
                      ) : null}
                      {selectedProfileSummary?.version ? (
                        <span className="badge badge-meta">
                          v{selectedProfileSummary.version}
                          {selectedProfileSummary.dirty ? "*" : ""}
                        </span>
                      ) : null}
                      {selectedProfileMetaTags.map((tag) => (
                        <span key={tag} className="badge badge-meta">
                          {tag}
                        </span>
                      ))}
                      <button
                        type="button"
                        className="icon-action status-edit-action"
                        onClick={() => openEditProfile(selectedProfile)}
                        disabled={!connected || switching}
                        aria-label={`Edit ${selectedProfile}`}
                        title="Edit profile"
                      >
                        <Pencil size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-action status-edit-action"
                        onClick={() =>
                          openCutForProfile(
                            selectedProfile,
                            selectedProfileSummary?.version ?? "",
                          )
                        }
                        disabled={
                          !connected
                          || !token
                          || switching
                          || !selectedProfileSummary?.version
                        }
                        aria-label={`Cut version for ${selectedProfile}`}
                        title={
                          selectedProfileSummary?.dirty
                            ? "Cut unpublished edits to a new version"
                            : "Cut a new version (fork current state)"
                        }
                      >
                        <Tag
                          size={HEADER_ICON_SIZE}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </button>
                      <ProfileDeleteControls
                        profileName={selectedProfile}
                        baseUrl={baseUrl}
                        token={token}
                        disabled={!connected || switching}
                        onDeleted={handleProfileDeleted}
                      />
                    </>
                  ) : (
                    "No profile selected"
                  )}
                </div>
                {selectedProfile ? (
                  <div
                    className="muted status-subline status-description"
                    title={selectedProfileSummary?.description ?? undefined}
                  >
                    {selectedProfileSummary?.description?.trim() || "\u00A0"}
                  </div>
                ) : null}
                {renameError ? (
                  <div className="muted status-subline status-rename-error">
                    {renameError}
                  </div>
                ) : null}
                {homeProfilePending && selectedIsActive && activeProfile ? (
                  <div className="muted status-subline">
                    <button
                      type="button"
                      className={[
                        "status-cta",
                        switching ? "is-busy" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={onPendingHomeApply}
                      disabled={
                        !connected || switching || bootstrapBusy
                      }
                      aria-busy={switching}
                    >
                      {switching ? <ButtonSpinner size={14} /> : null}
                      {switching
                        ? "Applying…"
                        : `Apply ${activeProfile} to global`}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {statusError && (
              <div className="banner error">
                <div>{statusError}</div>
                <button className="btn" type="button" onClick={() => void refreshStatus("full")}>
                  Retry
                </button>
              </div>
            )}

            {switching ? (
              <section aria-label="Apply progress">
                <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Applying…</h2>
                <ol className="steps">
                  {orderedSwitchSteps(view).map((step) => {
                    const state = stepState(step, switchEvents);
                    return (
                      <li
                        key={step}
                        className={
                          state === "current"
                            ? "cur"
                            : state === "done"
                              ? "done"
                              : state === "failed"
                                ? "cur"
                                : ""
                        }
                      >
                        {SWITCH_STEP_LABELS[step]}
                        {state === "failed" ? " — failed" : ""}
                      </li>
                    );
                  })}
                </ol>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void onCancelSwitch()}
                    disabled={isApplyStepActive(switchEvents)}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            ) : (
              <LiveStatePanel
                view={view}
                formatView={formatView}
                selectedProfile={selectedProfile}
                activeProfile={activeProfile}
                liveContents={status?.contents}
                applyPreview={applyPreview}
                applyPreviewLoading={applyPreviewLoading}
                applyPreviewError={applyPreviewError}
                onRetryPreview={() => setPreviewRetryKey((value) => value + 1)}
                onDismissPreviewError={() => setApplyPreviewError(null)}
                liveHarnesses={status?.harnesses}
                hasFullHarnessSnapshot={hasFullHarnessSnapshot}
                baseUrl={baseUrl}
                token={token}
                bootstrapBusy={bootstrapBusy}
                onBootstrap={() => {
                  void ensureProjectReady();
                }}
                onCreateProfileFromProject={() => {
                  openCreateProfile("project", true);
                }}
                onEditProfile={
                  selectedProfile
                    ? () => openEditProfile(selectedProfile)
                    : undefined
                }
                onAddResource={handleAddResource}
                addingResourceKey={addingResourceKey}
                onCommitManagedChanges={
                  connected && token && !switching
                    ? handleCommitManagedChanges
                    : undefined
                }
                committingManagedChanges={committingManagedChanges}
                onOpenResourceInEditor={
                  connected && token && !switching
                    ? handleOpenResourceInEditor
                    : undefined
                }
                onRemoveResourceFromProfile={
                  connected && token && !switching
                    ? handleRemoveResourceFromProfile
                    : undefined
                }
                removingResourceKey={removingResourceKey}
                filesRootPath={applyPreview?.files?.root_path ?? null}
                fileChangeBusyPath={fileChangeBusyPath}
                fileChangeBusyAction={fileChangeBusyAction}
                onOpenFileChange={
                  connected && token && !switching
                    ? handleOpenFileChange
                    : undefined
                }
                onDiffFileChange={
                  connected && token && !switching
                    ? handleDiffFileChange
                    : undefined
                }
                onAddFileChange={
                  connected && token && !switching
                    ? handleAddFileChange
                    : undefined
                }
                onDropFileChange={
                  connected && token && !switching
                    ? handleDropFileChange
                    : undefined
                }
                resourceActionError={
                  resourceActionError && !switching ? resourceActionError : null
                }
                onDismissResourceActionError={() => setResourceActionError(null)}
                onRecoveryAction={
                  connected && token && !switching
                    ? (action) => {
                        void handleRecoveryAction(action);
                      }
                    : undefined
                }
                recoveryBusy={recoveryBusy}
                onSuccess={(message) => {
                  setSuccessMessage(message);
                  window.setTimeout(() => setSuccessMessage(null), 3000);
                }}
                onLibraryChanged={() => {
                  setLibraryReloadKey((value) => value + 1);
                }}
              />
            )}

            {addResourceError && !switching ? (
              <div className="banner error" role="alert">
                <div>{addResourceError}</div>
                <div className="banner-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setAddResourceError(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            {switchError && !switching && (
              <div className="banner error">
                <div>{switchError}</div>
                <button className="btn" type="button" onClick={onApplyClick}>
                  Retry
                </button>
              </div>
            )}
          </main>
        )}
      </div>

      <CreateProfileDrawer
        open={createProfileOpen}
        baseUrl={baseUrl}
        token={token}
        projectPath={projectPath}
        disabled={switching}
        initialSource={createProfileInitialSource}
        initialSwitchAfterCreate={createProfileInitialSwitchAfterCreate}
        onClose={() => {
          setCreateProfileOpen(false);
          setCreateProfileInitialSource("compose");
          setCreateProfileInitialSwitchAfterCreate(false);
        }}
        onCreated={onProfileCreated}
      />

      <StashBrowseDrawer
        open={stashBrowseOpen}
        entries={stashEntries}
        baseUrl={baseUrl}
        token={token}
        onClose={() => setStashBrowseOpen(false)}
      />

      <SettingsDrawer
        open={settingsOpen}
        baseUrl={baseUrl}
        token={token}
        projectPath={view === "project" ? projectPath : null}
        inspectProjectPath={projectPath || null}
        disabled={switching}
        onClose={() => setSettingsOpen(false)}
        onSelectProject={selectProject}
        onBrowseProject={() => void browseProject()}
        onSaved={() => {
          void refreshStatus("full");
        }}
      />

      <CloudAccountDrawer
        open={cloudAccountOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onClose={() => setCloudAccountOpen(false)}
        onAuthChange={(next) => {
          setCloudAuth(next);
        }}
        onOrgSwitched={(slug) => {
          setSuccessMessage(`Switched to org: ${slug}`);
          window.setTimeout(() => setSuccessMessage(null), 3000);
        }}
      />

      <MigrateExportDrawer
        open={migrateExportOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onBusyChange={setMigrateBusy}
        onClose={() => {
          setMigrateExportOpen(false);
          setMigrateBusy(false);
        }}
        onExported={() => {
          setMigrateBusy(false);
        }}
      />
      <MigrateImportDrawer
        open={migrateImportOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onBusyChange={setMigrateBusy}
        onClose={() => {
          setMigrateImportOpen(false);
          setMigrateBusy(false);
        }}
        onImported={() => {
          setMigrateBusy(false);
          setLibraryReloadKey((value) => value + 1);
          void refreshProfiles();
          void refreshStatus("full");
          void refreshStash();
        }}
      />

      <ConfirmDialog
        open={reapplyConfirmOpen}
        title="Re-apply profile?"
        description={
          <p className="muted">
            Re-applying <strong>{activeProfile}</strong> will overwrite live
            harness files on {formatView(view)} with the saved profile state.
            Hand edits in those paths cannot be restored.
          </p>
        }
        confirmLabel="Re-apply"
        onConfirm={onConfirmReapply}
        onCancel={() => setReapplyConfirmOpen(false)}
      />

      <ConfirmDialog
        open={pendingRestoreChange !== null}
        title="Restore profile version?"
        description={
          <p className="muted">
            This will overwrite{" "}
            <span className="mono">{pendingRestoreChange?.path}</span> with the
            profile&apos;s expected content. Live edits to this file cannot be
            restored.
          </p>
        }
        confirmLabel="Restore"
        onConfirm={onConfirmRestoreFile}
        onCancel={() => setPendingRestoreChange(null)}
      />

      <FileDiffModal
        open={diffFileChange !== null}
        path={diffFileChange?.path ?? null}
        profileName={selectedProfile ?? activeProfile}
        scope={view}
        projectPath={projectPath}
        baseUrl={baseUrl}
        token={token}
        onClose={() => setDiffFileChange(null)}
      />

      <ConfirmDialog
        open={overwriteDialog}
        title="Overwrite owned profile paths?"
        description={
          <p className="muted">
            HarnessTap detected hand-edits inside paths owned by the last apply
            snapshot. Continuing will overwrite those owned keys.
          </p>
        }
        confirmLabel={showReapply ? "Re-apply anyway" : "Switch anyway"}
        onConfirm={onConfirmOverwrite}
        onCancel={() => setOverwriteDialog(false)}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id="skip-overwrite-prompt"
            checked={skipOverwritePrompt}
            onCheckedChange={(value) => setSkipOverwritePrompt(value === true)}
          />
          <Label
            htmlFor="skip-overwrite-prompt"
            className="font-normal text-muted-foreground"
          >
            Don&apos;t ask again this session
          </Label>
        </div>
      </ConfirmDialog>

      <CutVersionsModal
        open={cutModalOpen}
        rows={cutRows}
        busy={cutBusy}
        onRowsChange={setCutRows}
        onConfirm={() => void handleCutConfirm()}
        onCancel={() => {
          if (!cutBusy) {
            setCutModalOpen(false);
          }
        }}
      />
    </div>
    </Tooltip.Provider>
  );
}
