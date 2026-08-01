import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Archive, ArchiveRestore, Check, Cloud, FolderGit2, Globe, Library, Plus, RefreshCw, Unplug, User } from "lucide-react";
import { CloudAccountDrawer } from "./components/CloudAccountDrawer";
import { CloudBrowseDrawer } from "./components/CloudBrowseDrawer";
import { CreateProfileDrawer } from "./components/CreateProfileDrawer";
import { LiveStatePanel } from "./components/LiveStatePanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { StashBrowseDrawer } from "./components/StashBrowseDrawer";
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
  openResourcePath,
  removeProfileResource,
} from "./lib/agent-client";
import {
  loadRecentProjects,
  rememberProject,
} from "./lib/recent-projects";
import { mergeStatusUpdate } from "./lib/status-merge";
import type {
  CloudAuthStatus,
  GlobalProfileStatus,
  PanelTrafficStatus,
  ProfileApplyPreview,
  ProfileContentsResource,
  ProfileCreateSource,
  ProfileSummary,
  ProfileSwitchStep,
  ProfileSwitchStepEvent,
  ProfileStashEntry,
  ViewScope,
} from "./lib/types";
import { orderedSwitchSteps, SWITCH_STEP_LABELS } from "./lib/types";

type WorkspaceFocus = "resources" | "scope";

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

function projectDriftLabel(
  status: GlobalProfileStatus["drift_summary"]["project"] | undefined,
): string | null {
  if (!status) {
    return null;
  }
  switch (status.status) {
    case "na":
      return "Project not tracked yet";
    case "clean":
      return "Project files in sync with last snapshot";
    case "drifted":
      return "Project files have drifted from last snapshot";
    default: {
      const neverStatus: never = status.status;
      return neverStatus;
    }
  }
}

const POLL_MS = 2000;
const ACTIVITY_TTL_MS = 60_000;

function panelStatusLabel(status: PanelTrafficStatus | undefined): string {
  switch (status) {
    case "green":
      return "In sync";
    case "yellow":
      return "Needs attention";
    case "red":
      return "Out of sync";
    case undefined:
      return "Checking…";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

const PANEL_REASON_LABELS: Record<string, string> = {
  switch_failed: "Last switch failed",
  restore_failed: "Restore after switch failed",
  status_warning: "Status warning",
  profile_not_applied: "Active profile is not applied",
  stack_out_of_sync: "Applied stack is out of sync",
  owned_path_drift: "Owned global files have drifted",
  missing_plugins: "Required plugins are missing",
  missing_mcp: "Required MCP servers are missing",
  non_owned_drift: "Other global files have changed",
  project_drift: "Project files have drifted",
  fast_depth: "Quick check — refresh for full status",
};

function panelReasonTooltip(
  status: PanelTrafficStatus | undefined,
  reasons: string[] | undefined,
): string {
  const headline = panelStatusLabel(status);
  const details = (reasons ?? [])
    .map((reason) => PANEL_REASON_LABELS[reason] ?? reason)
    .filter((label, index, all) => all.indexOf(label) === index);
  if (details.length === 0) {
    return headline;
  }
  return `${headline}: ${details.join("; ")}`;
}

function globalDriftIssueLabel(
  status: GlobalProfileStatus["drift_summary"]["global"]["status"],
): string | null {
  switch (status) {
    case "clean":
      return null;
    case "pending":
      return "Global profile not applied";
    case "drifted":
      return "Global files have drifted";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

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
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [stashEntries, setStashEntries] = useState<ProfileStashEntry[]>([]);
  const [stashBusy, setStashBusy] = useState(false);
  const [status, setStatus] = useState<GlobalProfileStatus | null>(null);
  const [hasFullHarnessSnapshot, setHasFullHarnessSnapshot] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [applyPreview, setApplyPreview] = useState<ProfileApplyPreview | null>(null);
  const [applyPreviewError, setApplyPreviewError] = useState<string | null>(null);
  const [applyPreviewLoading, setApplyPreviewLoading] = useState(false);
  const [addingResourceKey, setAddingResourceKey] = useState<string | null>(null);
  const [removingResourceKey, setRemovingResourceKey] = useState<string | null>(null);
  const [addingAllResources, setAddingAllResources] = useState(false);
  const [addResourceError, setAddResourceError] = useState<string | null>(null);
  const [resourceActionError, setResourceActionError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  /** When true, keep an empty selection until the user picks a profile again. */
  const [preferEmptySelection, setPreferEmptySelection] = useState(false);
  const [profileFilter, setProfileFilter] = useState("");
  const [workspaceFocus, setWorkspaceFocus] = useState<WorkspaceFocus>("scope");
  const [view, setView] = useState<ViewScope>("home");
  const [switching, setSwitching] = useState(false);
  const [switchEvents, setSwitchEvents] = useState<ProfileSwitchStepEvent[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [createProfileInitialSource, setCreateProfileInitialSource] =
    useState<ProfileCreateSource>("compose");
  const [
    createProfileInitialSwitchAfterCreate,
    setCreateProfileInitialSwitchAfterCreate,
  ] = useState(false);
  const [cloudBrowseOpen, setCloudBrowseOpen] = useState(false);
  const [stashBrowseOpen, setStashBrowseOpen] = useState(false);
  const [cloudAccountOpen, setCloudAccountOpen] = useState(false);
  const [cloudAuth, setCloudAuth] = useState<CloudAuthStatus | null>(null);
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  /** Hide the “choose a project” banner without selecting a project. */
  const [projectPromptDismissed, setProjectPromptDismissed] = useState(false);
  /** Project path whose `.harnesstap/config.toml` is known ready (init or already existed). */
  const [projectConfigReadyPath, setProjectConfigReadyPath] = useState<string | null>(
    null,
  );
  const [refreshPhase, setRefreshPhase] = useState<"idle" | "loading" | "success">(
    "idle",
  );
  const [renamingProfile, setRenamingProfile] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameIgnoreBlurRef = useRef(false);
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
      return applyPreview.untracked_resources.length;
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
        : "No untracked resources to stash";
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
    const ok = await refreshStatus("full");
    if (!ok) {
      setRefreshPhase("idle");
      return;
    }
    setRefreshPhase("success");
    refreshFeedbackTimerRef.current = setTimeout(() => {
      setRefreshPhase("idle");
      refreshFeedbackTimerRef.current = null;
    }, 1200);
  }, [refreshPhase, refreshStatus]);

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

  const visibleProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) => profile.scopes.includes(view) && profile.name !== "empty",
      ),
    [profiles, view],
  );

  const filteredProfiles = useMemo(
    () => filterProfilesByQuery(visibleProfiles, profileFilter),
    [profileFilter, visibleProfiles],
  );

  const clearProfileSelection = useCallback(() => {
    setPreferEmptySelection(true);
    setSelectedProfile(null);
  }, []);

  const selectProfile = useCallback((name: string) => {
    setPreferEmptySelection(false);
    setSelectedProfile(name);
  }, []);

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
    setConnectionError(null);
    setConnected(false);
    try {
      const connection = await connectAgent({ restart: true });
      setBaseUrl(connection.baseUrl);
      setToken(connection.token);
      setConnected(true);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "Sidecar connection failed",
      );
    }
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
  ]);

  const handleAddResource = useCallback(
    async (resource: ProfileContentsResource) => {
      if (!baseUrl || !selectedProfile) {
        return;
      }
      const key = `${resource.type}:${resource.name}`;
      setAddingResourceKey(key);
      setAddResourceError(null);
      try {
        await addProfileResource(baseUrl, token, selectedProfile, {
          resourceType: resource.type,
          resourceName: resource.name,
          scope: view,
          ...(view === "project" && projectPath ? { projectPath } : {}),
        });
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
          error instanceof Error ? error.message : "Could not add resource to profile",
        );
      } finally {
        setAddingResourceKey(null);
      }
    },
    [
      activeProfile,
      baseUrl,
      projectPath,
      refreshStatus,
      selectedProfile,
      token,
      view,
    ],
  );

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

  const handleRemoveResourceFromProfile = useCallback(
    async (resource: ProfileContentsResource, layerId?: string) => {
      const profileName = selectedProfile ?? activeProfile;
      if (!baseUrl || !profileName) {
        return;
      }
      const key = `${resource.type}:${resource.name}`;
      setRemovingResourceKey(key);
      setResourceActionError(null);
      try {
        await removeProfileResource(baseUrl, token, profileName, {
          resourceType: resource.type,
          resourceName: resource.name,
          ...(layerId ? { layerId } : {}),
        });
        await refreshProfilePreview();
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
      selectedProfile,
      token,
    ],
  );

  const handleAddAllResources = useCallback(async () => {
    if (!baseUrl || !activeProfile) {
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

  const profilePanelResources = useMemo((): ProfileContentsResource[] | null => {
    if (!selectedProfile) {
      return null;
    }
    if (applyPreview?.contents) {
      return applyPreview.contents.resources ?? [];
    }
    if (selectedProfile === activeProfile && status?.contents) {
      return status.contents.resources ?? [];
    }
    return null;
  }, [
    activeProfile,
    applyPreview?.contents,
    selectedProfile,
    status?.contents,
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

  const applyHelper = useMemo(() => {
    if (switching) {
      return null;
    }
    if (!selectedProfile) {
      return "Select a profile to apply";
    }
    if (selectedProfile === activeProfile && status?.applied) {
      return `Already applied to ${formatView(view)}`;
    }
    return `Will apply: ${selectedProfile} · ${formatView(view)}`;
  }, [activeProfile, selectedProfile, status?.applied, switching, view]);

  const statusIssueParts = useMemo(() => {
    const parts: string[] = [];
    if (activeProfile && view === "home" && status) {
      const globalStatus = status.drift_summary.global.status;
      // Pending apply is rendered as a CTA, not plain text.
      if (globalStatus !== "pending") {
        const globalIssue = globalDriftIssueLabel(globalStatus);
        if (globalIssue) {
          parts.push(globalIssue);
        }
      }
    }
    if (view === "home" && status?.drift_summary.project?.status === "drifted") {
      parts.push("Project files have drifted");
    }
    return parts;
  }, [activeProfile, status, view]);

  const liveScopeLabel =
    view === "home"
      ? "Global live state"
      : projectPath
        ? `Project live state · ${projectPath}`
        : "Project live state";

  const projectStatusLine = useMemo(() => {
    if (view !== "project") {
      return null;
    }
    return projectDriftLabel(status?.drift_summary.project);
  }, [status?.drift_summary.project, view]);

  const panelTooltip = useMemo(
    () =>
      panelReasonTooltip(status?.panel.status, status?.panel.reasons),
    [status?.panel.reasons, status?.panel.status],
  );

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

  const onCloudPull = useCallback(
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

  const onSwitchClick = () => {
    void runSwitch(false);
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

  const beginRenameActiveProfile = () => {
    if (!activeProfile || !connected || switching || renameBusy) {
      return;
    }
    renameIgnoreBlurRef.current = false;
    setRenameDraft(activeProfile);
    setRenameError(null);
    setRenamingProfile(true);
  };

  const cancelRenameActiveProfile = () => {
    renameIgnoreBlurRef.current = true;
    setRenamingProfile(false);
    setRenameDraft("");
    setRenameError(null);
  };

  const commitRenameActiveProfile = async () => {
    if (!baseUrl || !activeProfile || renameBusy || renameIgnoreBlurRef.current) {
      return;
    }
    const nextName = renameDraft.trim();
    if (!nextName) {
      setRenameError("Name is required");
      window.setTimeout(() => renameInputRef.current?.focus(), 0);
      return;
    }
    if (nextName === activeProfile) {
      cancelRenameActiveProfile();
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await renameProfile(baseUrl, token, activeProfile, nextName);
      if (selectedProfile === result.old_name) {
        setSelectedProfile(result.name);
      }
      renameIgnoreBlurRef.current = true;
      setRenamingProfile(false);
      setRenameDraft("");
      await Promise.all([refreshProfiles(), refreshStatus("full")]);
      setSuccessMessage(`Renamed to ${result.name}`);
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      if (error instanceof AgentApiError && error.code === "layer_exists") {
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
    if (!activeProfile || switching) {
      cancelRenameActiveProfile();
    }
  }, [activeProfile, renamingProfile, switching]);

  const onConfirmOverwrite = () => {
    setOverwriteDialog(false);
    void runSwitch(true);
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

  const switchDisabled =
    !connected
    || switching
    || bootstrapBusy
    || !selectedProfile
    || (selectedProfile === activeProfile && Boolean(status?.applied))
    || (view === "project" && (!projectPath || !projectReady));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <h1>HarnessTap</h1>
        </div>
        <div className="header-focus" role="group" aria-label="Workspace">
          <div className="header-focus-controls">
            <button
              type="button"
              className={`header-focus-btn${workspaceFocus === "resources" ? " on" : ""}`}
              onClick={() => setWorkspaceFocus("resources")}
              disabled={switching}
              aria-label="Resources"
              title="Resources"
            >
              <Library size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            </button>
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
                onClick={() => onSelectView("home")}
                disabled={switching || bootstrapBusy}
                aria-label="Global"
                title="Global"
              >
                <Globe size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={
                  workspaceFocus === "scope" && view === "project" ? "on" : ""
                }
                onClick={() => onSelectView("project")}
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
              </button>
            </div>
          </div>
          {workspaceFocus === "scope" && view === "project" ? (
            <ProjectPicker
              projectPath={projectPath}
              disabled={switching}
              onSelect={selectProject}
              onBrowse={() => void browseProject()}
            />
          ) : (
            <div className="header-focus-spacer" aria-hidden />
          )}
        </div>
        <div className="header-status" aria-live="polite">
          {!connected ? (
            <span
              className="connection-indicator"
              title="Disconnected"
              aria-label="Disconnected"
              role="img"
            >
              <Unplug size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            </span>
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
            onClick={() => void onRefreshClick()}
            disabled={!connected || switching || refreshPhase === "loading"}
            aria-busy={refreshPhase === "loading"}
            aria-label={
              refreshPhase === "success"
                ? "Refreshed"
                : refreshPhase === "loading"
                  ? "Refreshing"
                  : "Refresh"
            }
            title={
              lastUpdated
                ? `Updated ${lastUpdated}`
                : refreshPhase === "loading"
                  ? "Refreshing…"
                  : "Refresh"
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
            className={[
              "icon-action",
              "account-action",
              cloudAuth?.authenticated ? "is-signed-in" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={() => setCloudAccountOpen(true)}
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
          <button className="btn" type="button" onClick={() => void retryConnection()}>
            Retry
          </button>
        </div>
      )}

      <div className="layout">
        <nav className="profiles-rail" aria-label="Profiles">
          <div className="profiles-brand">
            <span>Profiles</span>
            <div className="profiles-brand-actions">
              <div className="profiles-rail-toolbar">
                <button
                  className="icon-action rail-icon-action"
                  type="button"
                  onClick={() => void onStashProfile()}
                  disabled={
                    !connected
                    || !token
                    || switching
                    || stashBusy
                    || !canStashProfile
                  }
                  aria-label={
                    canStashProfile
                      ? `Stash untracked resources for ${activeProfile}`
                      : "Stash untracked resources"
                  }
                  title={
                    canStashProfile
                      ? `Stash ${status?.untracked_resource_count ?? 0} untracked resource${(status?.untracked_resource_count ?? 0) === 1 ? "" : "s"}`
                      : stashDisabledReason ?? "Stash untracked resources"
                  }
                >
                  <Archive size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  className="icon-action rail-icon-action"
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
                  <ArchiveRestore size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  className="icon-action rail-icon-action"
                  type="button"
                  onClick={() => openCreateProfile()}
                  disabled={!connected || switching || stashBusy}
                  aria-label="Create profile"
                  title="Create profile"
                >
                  <Plus size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  className="icon-action rail-icon-action"
                  type="button"
                  onClick={() => setCloudBrowseOpen(true)}
                  disabled={!connected || switching || stashBusy}
                  aria-label="Browse Cloud"
                  title="Browse Cloud"
                >
                  <Cloud size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
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
          <div className="profiles-list">
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
                      Local profile layers appear in Global. Switch to Project for
                      profiles enabled in the current project.
                    </>
                  )}
                </p>
                <button
                  className="btn primary"
                  type="button"
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
              return (
                <div
                  key={profile.name}
                  className={[
                    "profile-item",
                    isActive ? "active" : "",
                    isSelected ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="profile-item-main"
                    onClick={() => {
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
                  {showAddAll ? (
                    <button
                      type="button"
                      className="icon-action profile-item-action"
                      aria-label={`Add ${activeProfileUntrackedCount} untracked resources to profile`}
                      title={`Add all ${activeProfileUntrackedCount} untracked resources to profile`}
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
                      <Plus size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="rail-controls">
            {applyHelper ? <p className="muted apply-helper">{applyHelper}</p> : null}
            <button
              className="btn primary"
              type="button"
              onClick={onSwitchClick}
              disabled={switchDisabled}
            >
              {switching ? "Applying…" : "Apply"}
            </button>
          </div>
        </nav>

        {workspaceFocus === "resources" ? (
          <ResourcesPanel
            baseUrl={baseUrl}
            token={token}
            selectedProfile={selectedProfile}
            profileResources={profilePanelResources}
            profileContentsLoading={
              Boolean(selectedProfile) && applyPreviewLoading
            }
            disabled={switching}
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
                <div className="live-scope-label">{liveScopeLabel}</div>
                <div className="status-line" aria-live="polite">
                  {activeProfile ? (
                    <>
                      <span
                        className={`status-dot ${status?.panel.status ?? "yellow"}`}
                        title={panelTooltip}
                        aria-label={panelTooltip}
                        role="img"
                      />
                      {renamingProfile ? (
                        <input
                          ref={renameInputRef}
                          className="status-title-input"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitRenameActiveProfile();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRenameActiveProfile();
                            }
                          }}
                          onBlur={() => {
                            if (!renameBusy) {
                              void commitRenameActiveProfile();
                            }
                          }}
                          disabled={renameBusy}
                          aria-label="Rename active profile"
                        />
                      ) : (
                        <button
                          type="button"
                          className="status-title"
                          onDoubleClick={beginRenameActiveProfile}
                          disabled={!connected || switching}
                          title="Double-click to rename"
                        >
                          {activeProfile}
                        </button>
                      )}
                    </>
                  ) : (
                    "No active profile"
                  )}
                </div>
                {renameError ? (
                  <div className="muted status-subline status-rename-error">
                    {renameError}
                  </div>
                ) : null}
                {projectStatusLine ? (
                  <div className="muted status-subline">{projectStatusLine}</div>
                ) : null}
                {homeProfilePending || statusIssueParts.length > 0 ? (
                  <div className="muted status-subline">
                    {homeProfilePending && activeProfile ? (
                      <button
                        type="button"
                        className="status-cta"
                        onClick={onPendingHomeApply}
                        disabled={
                          !connected || switching || bootstrapBusy
                        }
                      >
                        Apply {activeProfile} to global
                      </button>
                    ) : null}
                    {homeProfilePending && statusIssueParts.length > 0 ? (
                      <span className="status-sep"> · </span>
                    ) : null}
                    {statusIssueParts.map((part, index) => (
                      <span key={part}>
                        {index > 0 ? <span className="status-sep"> · </span> : null}
                        {part}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {!projectPath && connected && !projectPromptDismissed && (
              <div className="banner">
                <div>
                  Choose a project to inspect project-scoped status, or keep working
                  on global-only profile switches.
                </div>
                <div className="banner-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setProjectPromptDismissed(true)}
                  >
                    Dismiss
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => onSelectView("project")}
                    disabled={switching || bootstrapBusy}
                  >
                    Browse…
                  </button>
                </div>
              </div>
            )}

            {successMessage ? (
              <div className="success-flash">{successMessage}</div>
            ) : null}

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
                onBrowseResources={() => setWorkspaceFocus("resources")}
                onAddResource={handleAddResource}
                addingResourceKey={addingResourceKey}
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
              />
            )}

            {addResourceError && !switching ? (
              <div className="banner error" role="alert">
                <div>{addResourceError}</div>
              </div>
            ) : null}
            {resourceActionError && !switching ? (
              <div className="banner error" role="alert">
                <div>{resourceActionError}</div>
              </div>
            ) : null}

            {switchError && !switching && (
              <div className="banner error">
                <div>{switchError}</div>
                <button className="btn" type="button" onClick={onSwitchClick}>
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

      <CloudBrowseDrawer
        open={cloudBrowseOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onClose={() => setCloudBrowseOpen(false)}
        onPull={onCloudPull}
        onRequestSignIn={() => {
          setCloudBrowseOpen(false);
          setCloudAccountOpen(true);
        }}
      />

      <StashBrowseDrawer
        open={stashBrowseOpen}
        entries={stashEntries}
        onClose={() => setStashBrowseOpen(false)}
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
      />

      {overwriteDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>Overwrite owned profile paths?</h2>
            <p className="muted">
              HarnessTap detected hand-edits inside paths owned by the last apply
              snapshot. Continuing will overwrite those owned keys.
            </p>
            <label className="muted">
              <input
                type="checkbox"
                checked={skipOverwritePrompt}
                onChange={(event) => setSkipOverwritePrompt(event.target.checked)}
              />{" "}
              Don&apos;t ask again this session
            </label>
            <div className="dialog-actions">
              <button className="btn" type="button" onClick={() => setOverwriteDialog(false)}>
                Cancel
              </button>
              <button className="btn primary" type="button" onClick={onConfirmOverwrite}>
                Switch anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
