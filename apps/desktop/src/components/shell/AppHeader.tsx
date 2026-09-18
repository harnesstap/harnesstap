import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FolderGit2,
  Globe,
  HardDriveDownload,
  Library,
  PackageSearch,
  RefreshCw,
  Settings,
  Upload,
  User,
} from "lucide-react";
import { rescanResourceTrackedDirectories } from "../../lib/agent-client";
import type { HeaderDestination } from "../../lib/header-destination";
import type { CloudAuthStatus } from "../../lib/types";
import type { AgentClient } from "../../state/agent-session";
import type { Destination, Scope } from "../../state/navigation";
import { statusStore } from "../../state/status-store";
import { toast } from "../../state/toast-store";
import { IconActionButton } from "../IconActionButton";
import { ParityChrome } from "../parity/ParityChrome";
import { ProjectHistoryControl } from "../parity/ProjectHistoryControl";
import { ProjectPicker } from "../ProjectPicker";
import { UpdateAvailableControl } from "../UpdateAvailableControl";

const HEADER_ICON_SIZE = 18;

export interface AppHeaderProps {
  client: AgentClient | null;
  connected: boolean;
  destination: Destination;
  scope: Scope;
  switching: boolean;
  bootstrapBusy: boolean;
  migrateBusy: boolean;
  installBusy: boolean;
  projectPath: string;
  projectReady: boolean;
  cloudAuth: CloudAuthStatus | null;
  onDestinationClick: (clicked: HeaderDestination) => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
  onProjectInstall: () => void;
  onProfilesChanged: () => void;
  onLibraryChanged: () => void;
  onOpenMigrateExport: () => void;
  onOpenMigrateImport: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

/** Brand, destinations, scope segment, project cluster, and utility actions. */
export function AppHeader({
  client,
  connected,
  destination,
  scope,
  switching,
  bootstrapBusy,
  migrateBusy,
  installBusy,
  projectPath,
  projectReady,
  cloudAuth,
  onDestinationClick,
  onSelectProject,
  onBrowseProject,
  onProjectInstall,
  onProfilesChanged,
  onLibraryChanged,
  onOpenMigrateExport,
  onOpenMigrateImport,
  onOpenSettings,
  onOpenAccount,
}: AppHeaderProps) {
  const baseUrl = client?.baseUrl ?? null;
  const token = client?.token ?? null;
  const [refreshPhase, setRefreshPhase] = useState<"idle" | "loading" | "success">("idle");
  const refreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (refreshFeedbackTimerRef.current) {
        clearTimeout(refreshFeedbackTimerRef.current);
      }
    };
  }, []);

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
    if (client && client.token) {
      try {
        await rescanResourceTrackedDirectories(client.baseUrl, client.token);
        onLibraryChanged();
      } catch (error) {
        rescanOk = false;
        statusStore.setStatusError(
          error instanceof Error ? error.message : "Could not rescan tracked directories",
        );
      }
    }
    const statusOk = await statusStore.refreshStatus("full", projectPath);
    if (!rescanOk || !statusOk) {
      setRefreshPhase("idle");
      return;
    }
    setRefreshPhase("success");
    refreshFeedbackTimerRef.current = setTimeout(() => {
      setRefreshPhase("idle");
      refreshFeedbackTimerRef.current = null;
    }, 1200);
  }, [client, onLibraryChanged, projectPath, refreshPhase]);

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <h1>HarnessTap</h1>
      </div>
      <div className="header-focus" role="group" aria-label="Workspace">
        <div className="header-focus-controls" role="navigation" aria-label="Destinations">
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "library" ? " on" : ""}`}
            onClick={() => onDestinationClick("library")}
            disabled={switching}
            aria-label="Library"
            aria-current={destination === "library" ? "page" : undefined}
            title="Library"
          >
            <Library size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            Library
          </button>
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "discover" ? " on" : ""}`}
            onClick={() => onDestinationClick("discover")}
            disabled={switching}
            aria-label="Discover"
            aria-current={destination === "discover" ? "page" : undefined}
            title="Discover"
          >
            <PackageSearch size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            Discover
          </button>
          <ParityChrome
            workspaceFocus={destination}
            onWorkspaceFocus={() => {
              onDestinationClick("environments");
            }}
            switching={switching}
          />
        </div>
        <div className="header-scope">
          <span className="header-scope-label" id="header-scope-label">
            Scope
          </span>
          <div
            className="header-focus-segment"
            role="group"
            aria-labelledby="header-scope-label"
          >
            <button
              type="button"
              className={scope === "global" ? "on" : ""}
              data-testid="view-global"
              onClick={() => onDestinationClick("global")}
              disabled={switching || bootstrapBusy}
              aria-label="Global scope"
              aria-pressed={scope === "global"}
              title="Global"
            >
              <Globe size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              Global
            </button>
            <button
              type="button"
              className={scope === "project" ? "on" : ""}
              data-testid="view-project"
              onClick={() => onDestinationClick("project")}
              disabled={switching || bootstrapBusy}
              aria-label="Project scope"
              aria-pressed={scope === "project"}
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
        {destination === "scope" && scope === "project" ? (
          <div className="header-project-row">
            <ProjectPicker
              projectPath={projectPath}
              disabled={switching}
              onSelect={onSelectProject}
              onBrowse={onBrowseProject}
            />
            {projectPath ? (
              <IconActionButton
                data-testid="project-install"
                label="Install"
                title="Install project config"
                busy={installBusy}
                disabled={!connected || !token || switching || bootstrapBusy || !projectReady}
                onClick={onProjectInstall}
                icon={<HardDriveDownload size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
              />
            ) : null}
            {projectPath ? (
              <ProjectHistoryControl
                baseUrl={baseUrl}
                token={token}
                connected={connected}
                switching={switching || installBusy}
                projectPath={projectPath}
                onSuccess={(message) => toast({ tone: "success", title: message })}
                onProfilesChanged={onProfilesChanged}
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
        <UpdateAvailableControl
          baseUrl={baseUrl}
          token={token}
          connected={connected}
          disabled={switching || migrateBusy}
        />
        <IconActionButton
          className={[
            "refresh-action",
            refreshPhase === "loading" ? "is-loading" : "",
            refreshPhase === "success" ? "is-success" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="header-refresh"
          onClick={() => void onRefreshClick()}
          disabled={!connected || switching || refreshPhase === "loading"}
          busy={refreshPhase === "loading"}
          label={
            refreshPhase === "success"
              ? "Refreshed"
              : refreshPhase === "loading"
                ? "Refreshing"
                : "Refresh live status"
          }
          title="Refresh live status"
          icon={
            refreshPhase === "success" ? (
              <Check size={HEADER_ICON_SIZE} strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <RefreshCw
                className="refresh-spinner"
                size={HEADER_ICON_SIZE}
                strokeWidth={2}
                aria-hidden="true"
              />
            )
          }
        />
        <IconActionButton
          data-testid="open-migrate-export"
          onClick={onOpenMigrateExport}
          disabled={!connected || switching || migrateBusy}
          label="Export setup"
          icon={<Upload size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
        <IconActionButton
          data-testid="open-migrate-import"
          onClick={onOpenMigrateImport}
          disabled={!connected || switching || migrateBusy}
          label="Import setup"
          icon={<Download size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
        <IconActionButton
          data-testid="open-settings"
          onClick={onOpenSettings}
          disabled={!connected}
          label="Settings"
          icon={<Settings size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
        <IconActionButton
          className={["account-action", cloudAuth?.authenticated ? "is-signed-in" : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={onOpenAccount}
          disabled={!connected}
          label="Account"
          title={
            cloudAuth?.authenticated
              ? cloudAuth.email
                ? `Account (${cloudAuth.email})`
                : "Account"
              : "Account"
          }
          icon={<User size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
      </div>
    </header>
  );
}
