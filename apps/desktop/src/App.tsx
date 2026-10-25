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
import { headerClickIntent, type Destination } from "./lib/header-destination";
import type { ProfileContentsResource } from "./lib/types";
import { useAgentSession } from "./state/agent-session";
import { useCloudAuth } from "./state/cloud-auth";
import { useNavigation, type Scope } from "./state/navigation";
import { useOverlays } from "./state/overlays";
import { useProject } from "./state/project";
import { useScopeController } from "./state/scope-controller";
import { useProjectScopePreload } from "./state/project-scope-preload";
import { discoverSnapshotStore } from "./state/discover-snapshot-store";
import { librarySnapshotStore } from "./state/library-snapshot-store";
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
  const [libraryFocusVersion, setLibraryFocusVersion] = useState<string | null>(null);
  const [libraryFocusResource, setLibraryFocusResource] = useState<string | null>(null);
  const [environmentCreateOpen, setEnvironmentCreateOpen] = useState(false);
  const [pendingHarnessAction, setPendingHarnessAction] = useState<
    "detect" | "sync" | null
  >(null);
  const [pluginApplyBusy, setPluginApplyBusy] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);

  const onLibraryChanged = useCallback(() => {
    setLibraryReloadKey((value) => value + 1);
    void librarySnapshotStore.invalidate();
    void discoverSnapshotStore.invalidate();
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
      librarySnapshotStore.clear();
      discoverSnapshotStore.clear();
      return;
    }
    librarySnapshotStore.setClient({ baseUrl: client.baseUrl, token: client.token });
    void librarySnapshotStore.loadPeek();
    discoverSnapshotStore.setClient({ baseUrl: client.baseUrl, token: client.token });
    void discoverSnapshotStore.warm();
    void statusStore.refreshProfiles(projectPath);
    void statusStore.refreshStatus("full", projectPath);
    void statusStore.refreshStash();
  }, [client, connected, projectPath]);

  useStatusPolling({ enabled: connected && !switching, projectPath });
  useProjectScopePreload({
    enabled: connected && Boolean(client),
    projectPath,
    switching,
  });

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

  const onDetectHarnesses = useCallback(() => {
    nav.go("harnesses");
    setPendingHarnessAction("detect");
  }, [nav.go]);

  const onSyncHarnesses = useCallback(() => {
    nav.go("harnesses");
    setPendingHarnessAction("sync");
  }, [nav.go]);

  const onPendingHarnessActionConsumed = useCallback(() => {
    setPendingHarnessAction(null);
  }, []);

  const openPluginInLibrary = useCallback(
    (pluginName: string, version?: string) => {
      setLibraryFocusPlugin(pluginName);
      setLibraryFocusVersion(version ?? null);
      goToLibrary();
    },
    [goToLibrary],
  );

  const openProfilePage = useCallback(
    (name: string) => {
      ctrl.closeEditProfile();
      ctrl.selectProfile(name);
      nav.go("scope");
    },
    [ctrl.closeEditProfile, ctrl.selectProfile, nav.go],
  );

  const openProfileEditor = useCallback(
    (name: string) => {
      nav.go("scope");
      ctrl.openEditProfile(name);
    },
    [ctrl.openEditProfile, nav.go],
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

  // A profile name opens that profile; a plain plugin opens in the Library (bell rows, env Used by profiles).
  const openProfileOrPlugin = useCallback(
    (name: string) => {
      if (ctrl.profiles.some((profile) => profile.name === name)) {
        ctrl.closeEditProfile();
        nav.go("scope");
        ctrl.selectProfile(name);
        return;
      }
      openPluginInLibrary(name);
    },
    [ctrl.closeEditProfile, ctrl.profiles, ctrl.selectProfile, nav, openPluginInLibrary],
  );

  const enterProjectScope = useCallback(
    async (path: string) => {
      if (await project.ensureProjectReady(path)) {
        nav.setScope("project");
      }
    },
    [nav.setScope, project.ensureProjectReady],
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
        const path = projectPath || (await project.browseProject());
        if (path) {
          await enterProjectScope(path);
        }
      })();
    },
    [ctrl.closeEditProfile, enterProjectScope, nav, project.browseProject, projectPath],
  );

  // Picking a project on the Profile tab opens that project's profiles.
  const onPickProject = useCallback(
    (path: string) => {
      selectProject(path);
      ctrl.closeEditProfile();
      void enterProjectScope(path);
    },
    [ctrl.closeEditProfile, enterProjectScope, selectProject],
  );

  const onBrowseProjectScope = useCallback(() => {
    void (async () => {
      const path = await project.browseProject();
      if (path) {
        ctrl.closeEditProfile();
        await enterProjectScope(path);
      }
    })();
  }, [ctrl.closeEditProfile, enterProjectScope, project.browseProject]);

  // "Choose project" inside a drawer: pick a folder without changing scope.
  const onChooseProject = useCallback(() => {
    void project.browseProject();
  }, [project.browseProject]);

  const onHeaderDestinationClick = useCallback(
    (clicked: Destination) => {
      if (headerClickIntent(nav.destination, clicked) === "reset") {
        if (clicked === "scope") {
          ctrl.setProfileFilter("");
          ctrl.closeEditProfile();
          return;
        }
        nav.resetCurrent();
        return;
      }
      ctrl.closeEditProfile();
      nav.go(clicked);
    },
    [ctrl.closeEditProfile, ctrl.setProfileFilter, nav],
  );

  const attachProfileName = selectedProfile ?? activeProfile;
  const discoverActive = nav.destination === "discover";
  const [discoverKept, setDiscoverKept] = useState(discoverActive);
  if (discoverActive && !discoverKept) {
    setDiscoverKept(true);
  }
  const onAddToProfile = useCallback(
    (resource: ProfileContentsResource) =>
      ctrl.handleAddResource(resource, attachProfileName ?? undefined),
    [attachProfileName, ctrl.handleAddResource],
  );
  const onAddToProfileAndApply = useCallback(
    (item: {
      kind: "plugin" | "resource";
      id: string;
      name: string;
      type: string;
    }) => ctrl.handleAttachLibraryItem(item, { apply: "always" }),
    [ctrl.handleAttachLibraryItem],
  );
  const onFocusPluginConsumed = useCallback(() => {
    setLibraryFocusPlugin(null);
    setLibraryFocusVersion(null);
  }, []);
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
            onSelectScope={onSelectScope}
            onPickProject={onPickProject}
            onBrowseProject={onBrowseProjectScope}
            onOpenPlugin={openPluginInLibrary}
            onOpenCreateProfile={overlays.openCreateProfile}
            onOpenStashBrowse={() => overlays.openOverlay("stashBrowse")}
            onRequestSignIn={openCloudAccount}
            onSetUpHarness={onDetectHarnesses}
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
            projectPath={projectPath || null}
            onChooseProject={onChooseProject}
            disabled={switching}
            disconnected={shellDisconnected}
            homeResetNonce={nav.resetNonce}
            autoOpenCreate={environmentCreateOpen}
            onAutoOpenCreateConsumed={onEnvironmentCreateConsumed}
            onOpenPlugin={openProfileOrPlugin}
            canWorkspaceBack={nav.hasHistory}
            onWorkspaceBack={nav.back}
            onSuccess={onSuccessToast}
          />
        );
      case "discover":
        return null;
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
            inventoryReloadKey={libraryReloadKey}
            pendingAction={pendingHarnessAction}
            onPendingActionConsumed={onPendingHarnessActionConsumed}
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
            openProjectPath={projectPath || null}
            onChooseProject={onChooseProject}
            selectedProfile={selectedProfile}
            attachProfileName={attachProfileName}
            onAddToProfile={onAddToProfile}
            focusPluginName={libraryFocusPlugin}
            focusPluginVersion={libraryFocusVersion}
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
            onOpenProfile={openProfilePage}
            onEditProfile={openProfileEditor}
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
            errorDetail={session.errorDetail}
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
          switching={switching}
          migrateBusy={migrateBusy}
          cloudAuth={cloud.cloudAuth}
          onDestinationClick={onHeaderDestinationClick}
          onOpenMigrateExport={() => overlays.openOverlay("migrateExport")}
          onOpenMigrateImport={() => overlays.openOverlay("migrateImport")}
          onOpenNotification={openProfileOrPlugin}
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
          {discoverKept ? (
            <div
              className="workspace-keep"
              hidden={!discoverActive}
              aria-hidden={!discoverActive}
            >
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
                currentProfileName={attachProfileName}
                onAddToProfileAndApply={onAddToProfileAndApply}
                onSuccess={onSuccessToast}
              />
            </div>
          ) : null}
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
          onDetectHarnesses={onDetectHarnesses}
          onSyncHarnesses={onSyncHarnesses}
        />
      </div>
      </CommandRegistryProvider>
    </Tooltip.Provider>
  );
}
