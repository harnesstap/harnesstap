import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentApiError,
  bootstrapProject,
  cancelSwitch,
  connectAgent,
  fetchPersonas,
  fetchStatus,
  startSwitch,
  subscribeSwitchEvents,
} from "./lib/agent-client";
import type {
  GlobalProfileStatus,
  PersonaSummary,
  ProfileSwitchStep,
  ProfileSwitchStepEvent,
  SwitchScope,
} from "./lib/types";
import { orderedSwitchSteps, SWITCH_STEP_LABELS } from "./lib/types";

const POLL_MS = 2000;

function formatScope(scope: SwitchScope): string {
  switch (scope) {
    case "home":
      return "Home";
    case "project":
      return "Project";
    case "both":
      return "Both";
    default: {
      const neverScope: never = scope;
      return neverScope;
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
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personasError, setPersonasError] = useState<string | null>(null);
  const [status, setStatus] = useState<GlobalProfileStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [scope, setScope] = useState<SwitchScope>("both");
  const [switching, setSwitching] = useState(false);
  const [switchEvents, setSwitchEvents] = useState<ProfileSwitchStepEvent[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState(false);
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [dismissBootstrap, setDismissBootstrap] = useState(false);
  const [projectPath, setProjectPath] = useState<string>("");
  const focusedRef = useRef(true);

  const activeProfile = status?.active_profile ?? null;
  const projectTracked =
    status?.drift_summary.project?.status !== "na" && status?.drift_summary.project !== undefined;
  const showBootstrapBanner =
    !dismissBootstrap
    && connected
    && status?.drift_summary.project?.status === "na"
    && projectPath.length > 0;

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

  const refreshPersonas = useCallback(async () => {
    if (!baseUrl) {
      return;
    }
    try {
      const next = await fetchPersonas(baseUrl);
      setPersonas(next);
      setPersonasError(null);
      if (!selectedPersona && next[0]) {
        setSelectedPersona(next[0].name);
      }
    } catch (error) {
      setPersonasError(
        error instanceof Error ? error.message : "Could not list personas",
      );
    }
  }, [baseUrl, selectedPersona]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await invoke<string>("get_project_path");
        if (!cancelled && path) {
          setProjectPath(path);
        }
      } catch {
        if (!cancelled) {
          setProjectPath("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connected || !baseUrl) {
      return;
    }
    void refreshPersonas();
    void refreshStatus("full");
  }, [connected, baseUrl, refreshPersonas, refreshStatus]);

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

  useEffect(() => {
    if (!activeProfile || !selectedPersona) {
      return;
    }
    if (projectTracked) {
      setScope("both");
    } else {
      setScope("home");
    }
  }, [activeProfile, projectTracked, selectedPersona]);

  const pendingSummary = useMemo(() => {
    if (!selectedPersona || selectedPersona === activeProfile) {
      return null;
    }
    return `Switch will apply: ${selectedPersona} · ${formatScope(scope)}`;
  }, [activeProfile, scope, selectedPersona]);

  const runSwitch = useCallback(
    async (confirmOwnedOverwrite = false) => {
      if (!baseUrl || !selectedPersona || !token) {
        return;
      }
      setSwitching(true);
      setSwitchEvents([]);
      setSwitchError(null);
      setSuccessMessage(null);
      try {
        const id = await startSwitch(baseUrl, token, {
          persona: selectedPersona,
          scope,
          ...(scope !== "home" && projectPath ? { projectPath } : {}),
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
              `Switched to ${selectedPersona} · ${formatScope(scope)}`,
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
      scope,
      selectedPersona,
      skipOverwritePrompt,
      token,
    ],
  );

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

  const onBootstrap = async () => {
    if (!baseUrl || !token || !projectPath) {
      return;
    }
    setBootstrapBusy(true);
    setBootstrapError(null);
    try {
      await bootstrapProject(baseUrl, token, projectPath);
      setDismissBootstrap(true);
      await refreshStatus("full");
    } catch (error) {
      setBootstrapError(
        error instanceof Error ? error.message : "Project setup failed",
      );
    } finally {
      setBootstrapBusy(false);
    }
  };

  const switchDisabled =
    !connected
    || switching
    || !selectedPersona
    || selectedPersona === activeProfile
    || ((scope === "project" || scope === "both") && !projectPath)
    || (scope !== "home" && !projectTracked);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>HarnessTap</h1>
          <div className="meta">
            desktop · sidecar {baseUrl ? new URL(baseUrl).port : "—"}
          </div>
        </div>
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
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="layout">
        <nav className="personas-rail" aria-label="Personas">
          <div className="personas-brand">Personas</div>
          <div className="personas-list">
            {personasError && (
              <div className="empty-state">
                <p>{personasError}</p>
                <button className="btn" type="button" onClick={() => void refreshPersonas()}>
                  Retry
                </button>
              </div>
            )}
            {!personasError && personas.length === 0 && (
              <div className="empty-state">
                <h2>No personas yet</h2>
                <p className="muted">
                  Layers tagged <span className="mono">profile</span> appear here.
                  Create one with{" "}
                  <span className="mono">ht profile create &lt;name&gt;</span>.
                </p>
              </div>
            )}
            {personas.map((persona) => {
              const isActive = persona.name === activeProfile;
              const isSelected = persona.name === selectedPersona;
              return (
                <button
                  key={persona.name}
                  type="button"
                  className={[
                    "persona-item",
                    isActive ? "active" : "",
                    isSelected ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelectedPersona(persona.name)}
                  disabled={switching}
                >
                  {persona.name}
                  {isActive ? <span className="badge">active</span> : null}
                </button>
              );
            })}
          </div>
          <div className="rail-controls">
            <div className="segment" role="group" aria-label="Switch scope">
              {(["home", "project", "both"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={scope === value ? "on" : ""}
                  onClick={() => setScope(value)}
                  disabled={switching || (value !== "home" && !projectTracked)}
                  title={
                    value !== "home" && !projectTracked
                      ? "Project scope requires a tracked HarnessTap project"
                      : undefined
                  }
                >
                  {formatScope(value)}
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
          {showBootstrapBanner && (
            <div className={`banner${bootstrapError ? " error" : ""}`}>
              <div>
                This repo isn&apos;t a HarnessTap project yet. Setup may write
                project files and gitignore entries.
                {bootstrapError ? ` ${bootstrapError}` : ""}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void onBootstrap()}
                  disabled={bootstrapBusy}
                >
                  Set up project
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setDismissBootstrap(true)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="live-toolbar">
            <div>
              <div className="status-line" aria-live="polite">
                <span
                  className={`status-dot ${status?.panel.status ?? "yellow"}`}
                />
                Live · {status?.panel.status ?? "yellow"}
              </div>
              <div className="muted mono">
                {activeProfile ?? "no active persona"}
                {projectPath ? ` · ${projectPath}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="pill warn">
                global {status?.drift_summary.global.status ?? "pending"}
              </span>
              <span className="pill">
                project {status?.drift_summary.project?.status ?? "na"}
              </span>
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
                {orderedSwitchSteps(scope).map((step) => {
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
                open={selectedPersona !== null && selectedPersona !== activeProfile}
              >
                <summary>Target preview</summary>
                <div className="drawer-body">
                  {selectedPersona ? (
                    <p className="muted">
                      Declared pins for <span className="mono">{selectedPersona}</span>{" "}
                      load with the next full status refresh after switch.
                    </p>
                  ) : (
                    <p className="muted">Select a persona to preview its target stack.</p>
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
