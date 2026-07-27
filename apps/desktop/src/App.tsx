import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderGit2, Home, Library, RefreshCw, Unplug, User } from "lucide-react";
import { CloudAccountDrawer } from "./components/CloudAccountDrawer";
import { CloudBrowseDrawer } from "./components/CloudBrowseDrawer";
import { CreateProfileDrawer } from "./components/CreateProfileDrawer";
import { LiveStatePanel } from "./components/LiveStatePanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { ResourcesPanel } from "./components/ResourcesPanel";
import {
  AgentApiError,
  bootstrapProject,
  cancelSwitch,
  connectAgent,
  fetchApplyPreview,
  fetchCloudAuthStatus,
  fetchProfiles,
  fetchStatus,
  startSwitch,
  subscribeSwitchEvents,
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
  ProfileSummary,
  ProfileSwitchStep,
  ProfileSwitchStepEvent,
  ViewScope,
} from "./lib/types";
import { orderedSwitchSteps, SWITCH_STEP_LABELS } from "./lib/types";

type WorkspaceFocus = "resources" | "scope";

const HEADER_ICON_SIZE = 18;

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
  owned_path_drift: "Owned home files have drifted",
  missing_plugins: "Required plugins are missing",
  missing_mcp: "Required MCP servers are missing",
  non_owned_drift: "Other home files have changed",
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
      return "Home profile not applied";
    case "drifted":
      return "Home files have drifted";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function formatView(view: ViewScope): string {
  switch (view) {
    case "home":
      return "Home";
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
  const [status, setStatus] = useState<GlobalProfileStatus | null>(null);
  const [hasFullHarnessSnapshot, setHasFullHarnessSnapshot] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [applyPreview, setApplyPreview] = useState<ProfileApplyPreview | null>(null);
  const [applyPreviewError, setApplyPreviewError] = useState<string | null>(null);
  const [applyPreviewLoading, setApplyPreviewLoading] = useState(false);
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
  const [cloudBrowseOpen, setCloudBrowseOpen] = useState(false);
  const [cloudAccountOpen, setCloudAccountOpen] = useState(false);
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
    () => profiles.filter((profile) => profile.scopes.includes(view)),
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
  }, [connected, baseUrl, projectPath, refreshProfiles, refreshStatus, refreshCloudAuth]);

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
      setSelectedProfile(visibleProfiles[0]?.name ?? null);
      return;
    }
    if (!visibleProfiles.some((profile) => profile.name === selectedProfile)) {
      setPreferEmptySelection(false);
      setSelectedProfile(visibleProfiles[0]?.name ?? null);
    }
  }, [visibleProfiles, selectedProfile, preferEmptySelection]);

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

  const pendingSummary = useMemo(() => {
    if (!selectedProfile || selectedProfile === activeProfile) {
      return null;
    }
    return `Will apply: ${selectedProfile} · ${formatView(view)}`;
  }, [activeProfile, view, selectedProfile]);

  const statusIssueParts = useMemo(() => {
    const parts: string[] = [];
    if (activeProfile && view === "home" && status) {
      const globalIssue = globalDriftIssueLabel(
        status.drift_summary.global.status,
      );
      if (globalIssue) {
        parts.push(globalIssue);
      }
    }
    if (view === "home" && status?.drift_summary.project?.status === "drifted") {
      parts.push("Project files have drifted");
    }
    return parts;
  }, [activeProfile, status, view]);

  const liveScopeLabel =
    view === "home"
      ? "Home live state"
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
              `Switched to ${targetProfile} · ${formatView(view)}`,
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
    || selectedProfile === activeProfile
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
                aria-label="Home"
                title="Home"
              >
                <Home size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
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
              <button
                className="rail-create-button"
                type="button"
                onClick={() => setCloudBrowseOpen(true)}
                disabled={!connected || switching}
              >
                Browse Cloud
              </button>
              <button
                className="rail-create-button"
                type="button"
                onClick={() => setCreateProfileOpen(true)}
                disabled={!connected || switching}
              >
                + Create
              </button>
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
                      : "No home profiles"}
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
                      Project view. Home-only profiles stay in Home.
                    </>
                  ) : (
                    <>
                      Local profile layers appear in Home. Switch to Project for
                      profiles enabled in the current project.
                    </>
                  )}
                </p>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => setCreateProfileOpen(true)}
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
              return (
                <button
                  key={profile.name}
                  type="button"
                  className={[
                    "profile-item",
                    isActive ? "active" : "",
                    isSelected ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
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
              );
            })}
          </div>
          <div className="rail-controls">
            {pendingSummary ? <p className="muted">{pendingSummary}</p> : null}
            <button
              className="btn primary"
              type="button"
              onClick={onSwitchClick}
              disabled={switchDisabled}
            >
              Apply
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
                      {activeProfile}
                    </>
                  ) : (
                    "No active profile"
                  )}
                </div>
                {projectStatusLine ? (
                  <div className="muted status-subline">{projectStatusLine}</div>
                ) : null}
                {statusIssueParts.length > 0 ? (
                  <div className="muted status-subline">
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

            {!projectPath && connected && (
              <div className="banner">
                <div>
                  Choose a project to inspect project-scoped status, or keep working
                  on home-only profile switches.
                </div>
                <button className="btn primary" type="button" onClick={() => void browseProject()}>
                  Browse…
                </button>
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
              <section aria-label="Switching progress">
                <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Switching…</h2>
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
              />
            )}

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
        onClose={() => setCreateProfileOpen(false)}
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
