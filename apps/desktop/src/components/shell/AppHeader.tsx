import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Cable,
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
import { ChromeTooltip } from "../ChromeTooltip";
import { IconActionButton } from "../IconActionButton";
import { ParityChrome } from "../parity/ParityChrome";
import { ProjectHistoryControl } from "../parity/ProjectHistoryControl";
import { ProjectPicker } from "../ProjectPicker";
import {
  refreshDesktopUpdateStatus,
  UpdateAvailableControl,
  useDesktopUpdateStatus,
} from "../UpdateAvailableControl";
import { HeaderMoreMenu } from "./HeaderMoreMenu";

const HEADER_ICON_SIZE = 18;
export const HEADER_DEST_ICONS_PX = 960;

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      const next = typeof box?.inlineSize === "number"
        ? box.inlineSize
        : entries[0]?.contentRect.width;
      if (typeof next === "number") {
        setWidth(next);
      }
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function maybeTooltip(enabled: boolean, content: string, child: ReactNode): ReactNode {
  if (!enabled) {
    return child;
  }
  return <ChromeTooltip content={content}>{child}</ChromeTooltip>;
}

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
  const headerRef = useRef<HTMLElement>(null);
  const headerWidth = useElementWidth(headerRef);
  const iconDestinations = headerWidth <= HEADER_DEST_ICONS_PX;
  const updateAvailable = useDesktopUpdateStatus()?.updateAvailable === true;
  const [refreshPhase, setRefreshPhase] = useState<"idle" | "loading" | "success">("idle");
  const refreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The Update menu item only mounts while More is open, so the header owns the check.
  useEffect(() => {
    if (!baseUrl || !connected) {
      return;
    }
    void refreshDesktopUpdateStatus(baseUrl, token);
  }, [baseUrl, connected, token]);

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

  const projectTooltip = !projectPath
    ? "Choose a project directory"
    : !projectReady
      ? "Sets up this repo as a HarnessTap project on first use"
      : "Project";
  const accountTooltip = cloudAuth?.authenticated && cloudAuth.email
    ? `Account (${cloudAuth.email})`
    : "Account";

  return (
    <header
      ref={headerRef}
      className={["app-header", iconDestinations ? "is-compact-dest" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="app-header-brand">
        <h1>HarnessTap</h1>
      </div>
      <div className="header-focus-controls" role="navigation" aria-label="Destinations">
        {maybeTooltip(
          iconDestinations,
          "Library",
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "library" ? " on" : ""}`}
            onClick={() => onDestinationClick("library")}
            disabled={switching}
            aria-label="Library"
            aria-current={destination === "library" ? "page" : undefined}
          >
            <Library size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Library</span>
          </button>,
        )}
        {maybeTooltip(
          iconDestinations,
          "Discover",
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "discover" ? " on" : ""}`}
            onClick={() => onDestinationClick("discover")}
            disabled={switching}
            aria-label="Discover"
            aria-current={destination === "discover" ? "page" : undefined}
          >
            <PackageSearch size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Discover</span>
          </button>,
        )}
        <ParityChrome
          workspaceFocus={destination}
          iconOnly={iconDestinations}
          onWorkspaceFocus={() => {
            onDestinationClick("environments");
          }}
          switching={switching}
        />
        {maybeTooltip(
          iconDestinations,
          "Harnesses",
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "harnesses" ? " on" : ""}`}
            onClick={() => onDestinationClick("harnesses")}
            disabled={switching}
            aria-label="Harnesses"
            aria-current={destination === "harnesses" ? "page" : undefined}
          >
            <Cable size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Harnesses</span>
          </button>,
        )}
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
          {maybeTooltip(
            iconDestinations,
            "Global",
            <button
              type="button"
              className={scope === "global" ? "on" : ""}
              data-testid="view-global"
              onClick={() => onDestinationClick("global")}
              disabled={switching || bootstrapBusy}
              aria-label="Global scope"
              aria-pressed={scope === "global"}
            >
              <Globe size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              <span className="header-focus-label">Global</span>
            </button>,
          )}
          {maybeTooltip(
            iconDestinations || projectTooltip !== "Project",
            projectTooltip,
            <button
              type="button"
              className={scope === "project" ? "on" : ""}
              data-testid="view-project"
              onClick={() => onDestinationClick("project")}
              disabled={switching || bootstrapBusy}
              aria-label="Project scope"
              aria-pressed={scope === "project"}
            >
              <FolderGit2 size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              <span className="header-focus-label">Project</span>
            </button>,
          )}
        </div>
      </div>
      {destination === "scope" && scope === "project" ? (
        <div className="header-project-cluster">
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
        <div className="header-project-cluster header-focus-spacer" aria-hidden />
      )}
      <div
        className="header-status"
        data-testid={connected ? "agent-connected" : undefined}
      >
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
          data-testid="open-settings"
          onClick={onOpenSettings}
          disabled={!connected}
          label="Settings"
          icon={<Settings size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
        <span className="header-more-wrap">
          <HeaderMoreMenu
            disabled={switching}
            attention={updateAvailable}
            items={[
              {
                id: "export",
                label: "Export setup",
                icon: <Upload size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />,
                disabled: !connected || switching || migrateBusy,
                onSelect: onOpenMigrateExport,
                testId: "open-migrate-export-more",
              },
              {
                id: "import",
                label: "Import setup",
                icon: <Download size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />,
                disabled: !connected || switching || migrateBusy,
                onSelect: onOpenMigrateImport,
                testId: "open-migrate-import-more",
              },
              {
                id: "account",
                label: accountTooltip,
                icon: <User size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />,
                disabled: !connected,
                onSelect: onOpenAccount,
                testId: "open-account-more",
              },
            ]}
          >
            <UpdateAvailableControl
              baseUrl={baseUrl}
              token={token}
              connected={connected}
              disabled={switching || migrateBusy}
              variant="menuitem"
            />
          </HeaderMoreMenu>
        </span>
      </div>
    </header>
  );
}
