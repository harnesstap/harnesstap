import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CloudBrowseDrawer } from "./components/CloudBrowseDrawer";
import { CreateProfileDrawer } from "./components/CreateProfileDrawer";
import { ProjectPicker } from "./components/ProjectPicker";
import {
  AgentApiError,
  bootstrapProject,
  cancelSwitch,
  connectAgent,
  fetchProfiles,
  fetchStatus,
  startSwitch,
  subscribeSwitchEvents,
} from "./lib/agent-client";
import {
  loadRecentProjects,
  rememberProject,
} from "./lib/recent-projects";
import type {
  GlobalProfileStatus,
  PanelTrafficStatus,
  ProfileSummary,
  ProfileSwitchStep,
  ProfileSwitchStepEvent,
  ViewScope,
} from "./lib/types";
import { orderedSwitchSteps, SWITCH_STEP_LABELS } from "./lib/types";

const POLL_MS = 2000;

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
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [view, setView] = useState<ViewScope>("home");
  const [switching, setSwitching] = useState(false);
  const [switchEvents, setSwitchEvents] = useState<ProfileSwitchStepEvent[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [cloudBrowseOpen, setCloudBrowseOpen] = useState(false);
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>(() => {
    const recent = loadRecentProjects();
    return recent[0]?.path ?? "";
  });
  const focusedRef = useRef(true);

  const selectProject = useCallback((path: string) => {
    const next = path.trim();
    if (!next) {
      return;
    }
    rememberProject(next);
    setProjectPath(next);
    setBootstrapError(null);
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

  const refreshStatus = useCallback(
    async (depth: "fast" | "full" = "fast") => {
      if (!baseUrl || switching) {
        return;
      }
      try {
        const next = await fetchStatus(
          baseUrl,
          depth,
          projectPath || undefined,
        );
        setStatus(next);
        setStatusError(null);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (error) {
        setStatusError(
          error instanceof Error ? error.message : "Could not read live status",
        );
      }
    },
    [baseUrl, projectPath, switching],
  );

  const refreshProfiles = useCallback(async () => {
    if (!baseUrl) {
      return;
    }
    try {
      const next = await fetchProfiles(baseUrl, projectPath || undefined);
      setProfiles(next);
      setProfilesError(null);
    } catch (error) {
      setProfilesError(
        error instanceof Error ? error.message : "Could not list profiles",
      );
    }
  }, [baseUrl, projectPath]);

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => profile.scopes.includes(view)),
    [profiles, view],
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
    void refreshProfiles();
    void refreshStatus("full");
  }, [connected, baseUrl, projectPath, refreshProfiles, refreshStatus]);

  useEffect(() => {
    if (visibleProfiles.length === 0) {
      if (selectedProfile !== null) {
        setSelectedProfile(null);
      }
      return;
    }
    if (
      !selectedProfile
      || !visibleProfiles.some((profile) => profile.name === selectedProfile)
    ) {
      setSelectedProfile(visibleProfiles[0]?.name ?? null);
    }
  }, [visibleProfiles, selectedProfile]);

  useEffect(() => {
    const onFocus = () => {
      focusedRef.current = true;
    };
    const onBlur = () => {
      focusedRef.current = false;
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!connected || switching) {
      return;
    }
    const timer = window.setInterval(() => {
      if (focusedRef.current) {
        void refreshStatus("fast");
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [connected, switching, refreshStatus]);

  const pendingSummary = useMemo(() => {
    if (!selectedProfile || selectedProfile === activeProfile) {
      return null;
    }
    return `Switch will apply: ${selectedProfile} · ${formatView(view)}`;
  }, [activeProfile, view, selectedProfile]);

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
      setSelectedProfile(profileName);
      if (shouldSwitch) {
        await runSwitch(false, profileName);
      }
    },
    [refreshProfiles, runSwitch],
  );

  const onCloudPull = useCallback(
    async (profileName: string, shouldSwitch: boolean) => {
      await refreshProfiles();
      setSelectedProfile(profileName);
      if (shouldSwitch) {
        await runSwitch(false, profileName);
      }
    },
    [refreshProfiles, runSwitch],
  );

  const ensureProjectReady = useCallback(async (): Promise<boolean> => {
    if (!baseUrl || !token || !projectPath) {
      return false;
    }
    if (projectTracked) {
      return true;
    }
    setBootstrapBusy(true);
    setBootstrapError(null);
    try {
      // Let the agent ensure a default profile and write project config.
      await bootstrapProject(baseUrl, token, { projectPath });
      await refreshProfiles();
      await refreshStatus("full");
      return true;
    } catch (error) {
      setBootstrapError(
        error instanceof Error ? error.message : "Project setup failed",
      );
      return false;
    } finally {
      setBootstrapBusy(false);
    }
  }, [
    baseUrl,
    projectPath,
    projectTracked,
    refreshProfiles,
    refreshStatus,
    token,
  ]);

  const onSelectView = (next: ViewScope) => {
    if (next === "home") {
      setView("home");
      return;
    }
    if (!projectPath) {
      setBootstrapError("Choose a project directory before using Project view.");
      return;
    }
    void (async () => {
      const ready = await ensureProjectReady();
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
    || (view === "project" && (!projectPath || !projectTracked));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <h1>HarnessTap</h1>
          <div className="meta">
            desktop · sidecar {baseUrl ? new URL(baseUrl).port : "—"}
          </div>
        </div>
        <ProjectPicker
          projectPath={projectPath}
          disabled={switching}
          onSelect={selectProject}
          onBrowse={() => void browseProject()}
        />
        <div className="meta" aria-live="polite">
          {connected ? "connected" : "disconnected"}
          {lastUpdated ? ` · updated ${lastUpdated}` : ""}
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
            {visibleProfiles.map((profile) => {
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
                  onClick={() => setSelectedProfile(profile.name)}
                  disabled={switching}
                >
                  {profile.name}
                  {isActive ? <span className="badge">active</span> : null}
                </button>
              );
            })}
          </div>
          <div className="rail-controls">
            <div className="segment" role="group" aria-label="View">
              {(["home", "project"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={view === value ? "on" : ""}
                  onClick={() => onSelectView(value)}
                  disabled={
                    switching
                    || bootstrapBusy
                    || (value === "project" && !projectPath)
                  }
                  title={
                    value === "project" && !projectPath
                      ? "Choose a project directory first"
                      : value === "project" && !projectTracked
                        ? "Sets up this repo as a HarnessTap project on first use"
                        : undefined
                  }
                >
                  {formatView(value)}
                </button>
              ))}
            </div>
            {pendingSummary ? <p className="muted">{pendingSummary}</p> : null}
            <button
              className="btn primary"
              type="button"
              onClick={onSwitchClick}
              disabled={switchDisabled}
            >
              Switch
            </button>
          </div>
        </nav>

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
                {activeProfile ?? "No active profile"}
              </div>
              <div className="muted status-subline">
                <span
                  className={`status-dot ${status?.panel.status ?? "yellow"}`}
                  aria-hidden
                />
                {panelStatusLabel(status?.panel.status)}
                <span className="status-sep">·</span>
                <span>
                  global {status?.drift_summary.global.status ?? "pending"}
                </span>
                <span className="status-sep">·</span>
                <span>
                  project {status?.drift_summary.project?.status ?? "na"}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                className="btn"
                type="button"
                onClick={() => void refreshStatus("full")}
                disabled={!connected || switching}
              >
                Refresh
              </button>
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
            <>
              {(["claude-code", "cursor"] as const).map((harnessId) => {
                const harness = status?.harnesses[harnessId];
                const missingPlugins =
                  harness?.plugins.filter((row) => row.state === "missing").length ?? 0;
                const missingMcp =
                  harness?.mcp.filter((row) => row.state === "missing").length ?? 0;
                const harnessOk = missingPlugins === 0 && missingMcp === 0;
                return (
                  <section key={harnessId} className="harness-block">
                    <div className="harness-header">
                      <span>{harnessId}</span>
                      <span className={`pill ${harnessOk ? "ok" : "bad"}`}>
                        {harnessOk ? "ok" : "issues"}
                      </span>
                    </div>
                    <div className="harness-body">
                      {(harness?.plugins ?? []).map((row) => (
                        <div className="kv" key={`${harnessId}-plugin-${row.id}`}>
                          <span>plugin {row.id}</span>
                          <span className="mono">{row.state}</span>
                        </div>
                      ))}
                      {(harness?.mcp ?? []).map((row) => (
                        <div className="kv" key={`${harnessId}-mcp-${row.name}`}>
                          <span>mcp {row.name}</span>
                          <span className="mono">{row.state}</span>
                        </div>
                      ))}
                      {!harness && (
                        <div className="muted">No harness data yet.</div>
                      )}
                    </div>
                  </section>
                );
              })}

              <details
                className="drawer"
                open={selectedProfile !== null && selectedProfile !== activeProfile}
              >
                <summary>Target preview</summary>
                <div className="drawer-body">
                  {selectedProfile ? (
                    <p className="muted">
                      Declared pins for <span className="mono">{selectedProfile}</span>{" "}
                      load with the next full status refresh after switch.
                    </p>
                  ) : (
                    <p className="muted">Select a profile to preview its target stack.</p>
                  )}
                </div>
              </details>
            </>
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
