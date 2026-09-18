import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { bootstrapProject } from "../lib/agent-client";
import { loadRecentProjects, rememberProject } from "../lib/recent-projects";
import type { AgentClient } from "./agent-session";
import { statusStore, useStatusStore } from "./status-store";

export interface ProjectState {
  projectPath: string;
  /** `apm.yml` exists (tracked by the agent, or initialised this session). */
  projectReady: boolean;
  bootstrapBusy: boolean;
  bootstrapError: string | null;
  clearBootstrapError: () => void;
  selectProject: (path: string) => void;
  /** Open the folder picker; resolves the chosen path (already selected) or null. */
  browseProject: () => Promise<string | null>;
  /** Init the project config if missing; resolves true when the scope can be used. */
  ensureProjectReady: (pathOverride?: string) => Promise<boolean>;
}

export function useProject(client: AgentClient | null): ProjectState {
  const [projectPath, setProjectPath] = useState<string>(() => {
    const recent = loadRecentProjects();
    return recent[0]?.path ?? "";
  });
  /** Project path whose `apm.yml` is known ready (init or already existed). */
  const [projectConfigReadyPath, setProjectConfigReadyPath] = useState<string | null>(
    null,
  );
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Config init ≠ DB tracking. Project view only needs apm.yml; drift "na"
  // still means "never applied", not "needs init again".
  const projectTracked = useStatusStore((state) => {
    const project = state.status?.drift_summary.project;
    return project !== undefined && project.status !== "na";
  });
  const projectReady =
    Boolean(projectPath)
    && (projectTracked || projectConfigReadyPath === projectPath);

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

  const browseProject = useCallback(async (): Promise<string | null> => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select project directory",
        defaultPath: projectPath || undefined,
      });
      if (typeof selected === "string" && selected.length > 0) {
        selectProject(selected);
        return selected;
      }
      return null;
    } catch (error) {
      statusStore.setStatusError(
        error instanceof Error ? error.message : "Could not open folder picker",
      );
      return null;
    }
  }, [projectPath, selectProject]);

  const ensureProjectReady = useCallback(
    async (pathOverride?: string): Promise<boolean> => {
      const path = (pathOverride ?? projectPath).trim();
      if (!client || !client.token || !path) {
        return false;
      }
      const alreadyReady =
        path === projectPath ? projectReady : projectConfigReadyPath === path;
      if (alreadyReady) {
        return true;
      }
      setBootstrapBusy(true);
      setBootstrapError(null);
      try {
        // Init only when config is missing; agent bootstrap is idempotent if present.
        await bootstrapProject(client.baseUrl, client.token, { projectPath: path });
        setProjectConfigReadyPath(path);
        await statusStore.refreshProfiles(path);
        await statusStore.refreshStatus("full", path);
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
    [client, projectConfigReadyPath, projectPath, projectReady],
  );

  const clearBootstrapError = useCallback(() => setBootstrapError(null), []);

  return {
    projectPath,
    projectReady,
    bootstrapBusy,
    bootstrapError,
    clearBootstrapError,
    selectProject,
    browseProject,
    ensureProjectReady,
  };
}
