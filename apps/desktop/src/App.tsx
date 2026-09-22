import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { AppHeader } from "./components/shell/AppHeader";
import { AppOverlays } from "./components/shell/AppOverlays";
import { ConnectSplash, ReconnectBanner } from "./components/shell/ConnectSplash";
import { CommandPaletteHost } from "./components/shell/CommandPalette";
import { ScopeWorkspace } from "./components/shell/ScopeWorkspace";
import { CommandRegistryProvider } from "./state/command-registry";
import { EnvironmentsWorkspace } from "./components/parity/EnvironmentsWorkspace";
import { HarnessesWorkspace } from "./components/harnesses/HarnessesWorkspace";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { SourcesWorkspace } from "./components/SourcesWorkspace";
import {
  activeHeaderDestination,
  headerClickIntent,
  headerDestinationTarget,
  type HeaderDestination,
} from "./lib/header-destination";
import type { ProfileContentsResource } from "./lib/types";
import { useAgentSession } from "./state/agent-session";
import { useCloudAuth } from "./state/cloud-auth";
import { useNavigation, type Scope } from "./state/navigation";
import { useOverlays } from "./state/overlays";
import { useProject } from "./state/project";
import { useScopeController } from "./state/scope-controller";
import { statusStore, useStatusPolling } from "./state/status-store";
import { useTelemetryConsent } from "./state/telemetry-consent";
import { toast } from "./state/toast-store";

// Workspaces keep their own state; a status poll must not re-render them.
const MemoResourcesPanel = memo(ResourcesPanel);
const MemoSourcesWorkspace = memo(SourcesWorkspace);
const MemoEnvironmentsWorkspace = memo(EnvironmentsWorkspace);
const MemoHarnessesWorkspace = memo(HarnessesWorkspace);

export function App() {
  const session = useAgentSession();
  const { client, connected } = session;
  const nav = useNavigation();
  const overlays = useOverlays();
  const project = useProject(client);
  const { projectPath, projectReady, bootstrapBusy, selectProject, browseProject } = project;
  const telemetry = useTelemetryConsent(client);
  const cloud = useCloudAuth(client);

  const [libraryReloadKey, setLibraryReloadKey] = useState(0);
  const [libraryFocusPlugin, setLibraryFocusPlugin] = useState<string | null>(null);
  const [libraryFocusResource, setLibraryFocusResource] = useState<string | null>(null);
  const [environmentCreateOpen, setEnvironmentCreateOpen] = useState(false);
  const [pluginApplyBusy, setPluginApplyBusy] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);

  const onLibraryChanged = useCallback(() => {
    setLibraryReloadKey((value) => value + 1);
  }, []);

  const ctrl = useScopeController({
    client,
    connected,
    scope: nav.scope,
    projectPath,
    projectReady,
    bootstrapBusy,
    pluginApplyBusy,
    onLibraryChanged,
  });
  const { switching, activeProfile, selectedProfile } = ctrl;

  useEffect(() => {
    statusStore.setClient(client);
  }, [client]);

  useEffect(() => {
    if (!connected || !client) {
      return;
    }
    void statusStore.refreshProfiles(projectPath);
    void statusStore.refreshStatus("full", projectPath);
    void statusStore.refreshStash();
  }, [client, connected, projectPath]);

  useStatusPolling({ enabled: connected && !switching, projectPath });

  useEffect(() => {
    nav.setNestedDepth(ctrl.editingProfile ? 1 : 0);
  }, [ctrl.editingProfile, nav.setNestedDepth]);

  const onProfilesChanged = useCallback(() => {
    void statusStore.refreshProfiles(projectPath);
    void statusStore.refreshStatus("full", projectPath);
  }, [projectPath]);

  const onHarnessesChanged = useCallback(() => {
    void statusStore.refreshStatus("full", projectPath);
    onLibraryChanged();
  }, [onLibraryChanged, projectPath]);

  const onSuccessToast = useCallback((message: string) => {
    toast({ tone: "success", title: message });
  }, []);

  const goToLibrary = useCallback(() => nav.go("library"), [nav.go]);

  const openPluginInLibrary = useCallback(
    (pluginName: string) => {
      setLibraryFocusPlugin(pluginName);
      goToLibrary();
    },
    [goToLibrary],
  );

  const openInLibrary = useCallback(
    (selector: string) => {
      if (selector.includes(":")) {
        setLibraryFocusResource(selector);
      } else {
        setLibraryFocusPlugin(selector);
      }
      goToLibrary();
    },
    [goToLibrary],
  );

  const onSelectScope = useCallback(
    (next: Scope) => {
      ctrl.closeEditProfile();
      nav.go("scope");
      if (next === "global") {
        nav.setScope("global");
        return;
      }
      void (async () => {
        let path = projectPath;
        if (!path) {
          const selected = await project.browseProject();
          path = selected ?? "";
          if (!path) {
            return;
          }
        }
        if (await project.ensureProjectReady(path)) {
          nav.setScope("project");
        }
      })();
    },
    [ctrl.closeEditProfile, nav, project, projectPath],
  );

  const onHeaderDestinationClick = useCallback(
    (clicked: HeaderDestination) => {
      const active = activeHeaderDestination(nav.destination, nav.scope);
      if (headerClickIntent(active, clicked) === "reset") {
        switch (clicked) {
          case "library":
          case "discover":
          case "environments":
          case "harnesses":
            nav.resetCurrent();
            return;
          case "global":
          case "project":
            ctrl.setProfileFilter("");
            ctrl.closeEditProfile();
            return;
          default: {
            const neverClicked: never = clicked;
            return neverClicked;
          }
        }
      }
      const target = headerDestinationTarget(clicked);
      if (target.scope) {
        onSelectScope(target.scope);
        return;
      }
      ctrl.closeEditProfile();
      nav.go(target.destination);
    },
    [ctrl.closeEditProfile, ctrl.setProfileFilter, nav, onSelectScope],
  );

  const attachProfileName = selectedProfile ?? activeProfile;
  const onAddToProfile = useCallback(
    (resource: ProfileContentsResource) =>
      ctrl.handleAddResource(resource, attachProfileName ?? undefined),
    [attachProfileName, ctrl.handleAddResource],
  );
  const onFocusPluginConsumed = useCallback(() => setLibraryFocusPlugin(null), []);
  const onFocusResourceConsumed = useCallback(() => setLibraryFocusResource(null), []);
  const onImported = useCallback(
    (message: string) => {
      toast({ tone: "success", title: message });
      onLibraryChanged();
    },
    [onLibraryChanged],
  );
  const onEnvironmentCreateConsumed = useCallback(() => setEnvironmentCreateOpen(false), []);
  const openCloudAccount = useCallback(
    () => overlays.openOverlay("cloudAccount"),
    [overlays.openOverlay],
  );
  const scopedProjectPath = nav.scope === "project" ? projectPath : null;
  const shellDisconnected = session.phase !== "connected";

  const renderWorkspace = (): ReactNode => {
    switch (nav.destination) {
      case "scope":
        return (
          <ScopeWorkspace
            ctrl={ctrl}
            disconnected={shellDisconnected}
            hasHistory={nav.hasHistory}
            onBack={nav.back}
            libraryReloadKey={libraryReloadKey}
            bootstrapBusy={bootstrapBusy}
            bootstrapError={project.bootstrapError}
            onDismissBootstrapError={project.clearBootstrapError}
            onBootstrap={() => void project.ensureProjectReady()}
            onOpenPlugin={openPluginInLibrary}
            onOpenCreateProfile={overlays.openCreateProfile}
            onOpenStashBrowse={() => overlays.openOverlay("stashBrowse")}
            onRequestSignIn={openCloudAccount}
            onCreateEnvironment={() => {
              setEnvironmentCreateOpen(true);
              nav.go("environments");
            }}
          />
        );
      case "environments":
        return (
          <MemoEnvironmentsWorkspace
            baseUrl={client?.baseUrl ?? null}
            token={client?.token ?? null}
            projectPath={scopedProjectPath}
            disabled={switching}
            disconnected={shellDisconnected}
            homeResetNonce={nav.resetNonce}
            autoOpenCreate={environmentCreateOpen}
            onAutoOpenCreateConsumed={onEnvironmentCreateConsumed}
            onOpenPlugin={openPluginInLibrary}
            canWorkspaceBack={nav.hasHistory}
            onWorkspaceBack={nav.back}
            onSuccess={onSuccessToast}
          />
        );
      case "discover":
        return (
          <MemoSourcesWorkspace
            baseUrl={client?.baseUrl ?? null}
            token={client?.token ?? null}
            disabled={switching}
            disconnected={shellDisconnected}
            homeResetNonce={nav.resetNonce}
            cloudAuthenticated={Boolean(cloud.cloudAuth?.authenticated)}
            onSignIn={openCloudAccount}
            canWorkspaceBack={nav.hasHistory}
            onWorkspaceBack={nav.back}
            onOpenInLibrary={openInLibrary}
            onSuccess={onSuccessToast}
          />
        );
      case "harnesses":
        return (
          <MemoHarnessesWorkspace
            baseUrl={client?.baseUrl ?? null}
            token={client?.token ?? null}
            connected={connected}
            disabled={switching}
            disconnected={shellDisconnected}
            homeResetNonce={nav.resetNonce}
            canWorkspaceBack={nav.hasHistory}
            onWorkspaceBack={nav.back}
            onNestedDepthChange={nav.setNestedDepth}
            onSuccess={onSuccessToast}
            onHarnessesChanged={onHarnessesChanged}
          />
        );
      case "library":
        return (
          <MemoResourcesPanel
            baseUrl={client?.baseUrl ?? null}
            token={client?.token ?? null}
            reloadKey={libraryReloadKey}
            disabled={switching}
            disconnected={shellDisconnected}
            homeResetNonce={nav.resetNonce}
            projectPath={scopedProjectPath}
            selectedProfile={selectedProfile}
            attachProfileName={attachProfileName}
            onAddToProfile={onAddToProfile}
            focusPluginName={libraryFocusPlugin}
            onFocusPluginConsumed={onFocusPluginConsumed}
            focusResourceSelector={libraryFocusResource}
            onFocusResourceConsumed={onFocusResourceConsumed}
            onBusyChange={setPluginApplyBusy}
            canWorkspaceBack={nav.hasHistory}
            onWorkspaceBack={nav.back}
            autoOpenTrackedDirectories={session.firstRun}
            onProfilesChanged={onProfilesChanged}
            onImported={onImported}
            onSuccess={onSuccessToast}
            onApplyResult={ctrl.setPendingTrustFromResult}
          />
        );
      default: {
        const neverDestination: never = nav.destination;
        return neverDestination;
      }
    }
  };

  if (!client) {
    return (
      <Tooltip.Provider delayDuration={400}>
        <div className="app-shell">
          <ConnectSplash
            phase={session.phase}
            error={session.error}
            retryBusy={session.retryBusy}
            onRetry={() => void session.retry()}
          />
        </div>
      </Tooltip.Provider>
    );
  }

  return (
    <Tooltip.Provider delayDuration={400}>
      <CommandRegistryProvider>
      <div className="app-shell">
        <AppHeader
          client={client}
          connected={connected}
          destination={nav.destination}
          scope={nav.scope}
          switching={switching}
          bootstrapBusy={bootstrapBusy}
          migrateBusy={migrateBusy}
          installBusy={ctrl.installBusy}
          projectPath={projectPath}
          projectReady={projectReady}
          cloudAuth={cloud.cloudAuth}
          onDestinationClick={onHeaderDestinationClick}
          onSelectProject={selectProject}
          onBrowseProject={() => void browseProject()}
          onProjectInstall={() => void ctrl.runProjectInstall()}
          onProfilesChanged={onProfilesChanged}
          onLibraryChanged={onLibraryChanged}
          onOpenMigrateExport={() => overlays.openOverlay("migrateExport")}
          onOpenMigrateImport={() => overlays.openOverlay("migrateImport")}
          onOpenSettings={() => overlays.openOverlay("settings")}
          onOpenAccount={openCloudAccount}
        />

        {!connected && (
          <ReconnectBanner
            retryBusy={session.retryBusy}
            onRetry={() => void session.retry()}
          />
        )}

        <div
          className={`layout${nav.destination === "scope" ? "" : " resources-focus"}${
            shellDisconnected ? " is-disconnected" : ""
          }`}
        >
          {renderWorkspace()}
        </div>

        <AppOverlays
          client={client}
          ctrl={ctrl}
          overlays={overlays}
          projectPath={projectPath}
          telemetryConsent={telemetry.consent}
          telemetryConsentBusy={telemetry.busy}
          onAnswerTelemetryConsent={(enabled) => void telemetry.answer(enabled)}
          onTelemetryConsentChange={telemetry.sync}
          onSelectProject={selectProject}
          onBrowseProject={() => void browseProject()}
          onCloudAuthChange={cloud.setCloudAuth}
          migrateBusy={migrateBusy}
          onMigrateBusyChange={setMigrateBusy}
          onLibraryChanged={onLibraryChanged}
        />
        <CommandPaletteHost
          nav={nav}
          overlays={overlays}
          ctrl={ctrl}
          onSelectScope={onSelectScope}
          onSelectProject={selectProject}
          ensureProjectReady={project.ensureProjectReady}
        />
      </div>
      </CommandRegistryProvider>
    </Tooltip.Provider>
  );
}
