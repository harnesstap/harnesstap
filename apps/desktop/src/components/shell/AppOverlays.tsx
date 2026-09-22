import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { compactHomePath } from "../../lib/compact-path";
import { openResourcePath } from "../../lib/agent-client";
import { formatScope } from "../../lib/api/scope";
import { shouldShowTelemetryConsentModal } from "../../lib/telemetry-consent";
import type {
  CloudAuthStatus,
  MigrateExportResult,
  MigrateImportResult,
  TelemetryConsentStatus,
} from "../../lib/types";
import type { AgentClient } from "../../state/agent-session";
import type { Overlays } from "../../state/overlays";
import type { ScopeController } from "../../state/scope-controller";
import { statusStore } from "../../state/status-store";
import { toast } from "../../state/toast-store";
import { CloudAccountDrawer } from "../CloudAccountDrawer";
import { ConfirmDialog } from "../ConfirmDialog";
import { CreateProfileDrawer } from "../CreateProfileDrawer";
import { CutVersionsModal } from "../CutVersionsModal";
import { FileDiffModal } from "../FileDiffModal";
import { MigrateExportDrawer } from "../MigrateExportDrawer";
import { MigrateImportDrawer } from "../MigrateImportDrawer";
import { SettingsDrawer } from "../SettingsDrawer";
import { StashBrowseDrawer } from "../StashBrowseDrawer";
import { TelemetryConsentModal } from "../TelemetryConsentModal";
import { ToastRegion } from "./ToastRegion";

export function describeExport(result: MigrateExportResult): string {
  return `Exported to ${compactHomePath(result.output, 80)}`;
}

export function describeImport(result: MigrateImportResult): string {
  switch (result.scope) {
    case "workspace":
      return `Imported ${result.plugins_imported} plugin${result.plugins_imported === 1 ? "" : "s"}, ${result.environments_imported} environment${result.environments_imported === 1 ? "" : "s"}`;
    case "plugin":
      return `Imported ${result.resources_imported} resource${result.resources_imported === 1 ? "" : "s"}, ${result.plugins.length} plugin${result.plugins.length === 1 ? "" : "s"}`;
    case "resource":
      return "Imported 1 resource";
    default: {
      const neverResult: never = result;
      return neverResult;
    }
  }
}

export interface AppOverlaysProps {
  client: AgentClient | null;
  ctrl: ScopeController;
  overlays: Overlays;
  projectPath: string;
  telemetryConsent: TelemetryConsentStatus | null;
  telemetryConsentBusy: boolean;
  onAnswerTelemetryConsent: (enabled: boolean) => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
  onCloudAuthChange: (next: CloudAuthStatus | null) => void;
  onTelemetryConsentChange?: (next: TelemetryConsentStatus) => void;
  migrateBusy: boolean;
  onMigrateBusyChange: (busy: boolean) => void;
  onLibraryChanged: () => void;
}

/** Every shell-level overlay, confirm, and the toast region. */
export function AppOverlays({
  client,
  ctrl,
  overlays,
  projectPath,
  telemetryConsent,
  telemetryConsentBusy,
  onAnswerTelemetryConsent,
  onSelectProject,
  onBrowseProject,
  onCloudAuthChange,
  onTelemetryConsentChange,
  onMigrateBusyChange,
  onLibraryChanged,
}: AppOverlaysProps) {
  const baseUrl = client?.baseUrl ?? null;
  const token = client?.token ?? null;
  const { switching, scope, activeProfile, selectedProfile, showReapply } = ctrl;

  return (
    <>
      <CreateProfileDrawer
        open={overlays.isOpen("createProfile")}
        baseUrl={baseUrl}
        token={token}
        projectPath={projectPath}
        disabled={switching}
        initialSource={overlays.createProfile.source}
        initialSwitchAfterCreate={overlays.createProfile.switchAfterCreate}
        onClose={() => overlays.closeOverlay("createProfile")}
        onCreated={ctrl.onProfileCreated}
      />

      <StashBrowseDrawer
        open={overlays.isOpen("stashBrowse")}
        entries={ctrl.stashEntries}
        baseUrl={baseUrl}
        token={token}
        onClose={() => overlays.closeOverlay("stashBrowse")}
      />

      {telemetryConsent ? (
        <TelemetryConsentModal
          open={shouldShowTelemetryConsentModal(telemetryConsent)}
          copy={telemetryConsent.copy}
          busy={telemetryConsentBusy}
          onEnable={() => onAnswerTelemetryConsent(true)}
          onDisable={() => onAnswerTelemetryConsent(false)}
        />
      ) : null}

      <SettingsDrawer
        open={overlays.isOpen("settings")}
        baseUrl={baseUrl}
        token={token}
        inspectProjectPath={projectPath || null}
        disabled={switching}
        onClose={() => overlays.closeOverlay("settings")}
        onSelectProject={onSelectProject}
        onBrowseProject={onBrowseProject}
        onTelemetryConsentChange={onTelemetryConsentChange}
        onSaved={() => {
          toast({ tone: "success", title: "Settings saved" });
          void statusStore.refreshStatus("full", projectPath);
        }}
      />

      <CloudAccountDrawer
        open={overlays.isOpen("cloudAccount")}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onClose={() => overlays.closeOverlay("cloudAccount")}
        onAuthChange={onCloudAuthChange}
        onOrgSwitched={(slug) => toast({ tone: "success", title: `Switched to org: ${slug}` })}
      />

      <MigrateExportDrawer
        open={overlays.isOpen("migrateExport")}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onBusyChange={onMigrateBusyChange}
        onClose={() => {
          overlays.closeOverlay("migrateExport");
          onMigrateBusyChange(false);
        }}
        onExported={(result) => {
          onMigrateBusyChange(false);
          const path = result.output;
          toast({
            tone: "success",
            title: describeExport(result),
            action: client
              ? {
                  label: "Reveal",
                  onClick: () => {
                    void openResourcePath(client.baseUrl, client.token, {
                      path,
                      reveal: true,
                    });
                  },
                }
              : undefined,
          });
        }}
      />
      <MigrateImportDrawer
        open={overlays.isOpen("migrateImport")}
        baseUrl={baseUrl}
        token={token}
        disabled={switching}
        onBusyChange={onMigrateBusyChange}
        onClose={() => {
          overlays.closeOverlay("migrateImport");
          onMigrateBusyChange(false);
        }}
        onImported={(result) => {
          onMigrateBusyChange(false);
          onLibraryChanged();
          void statusStore.refreshProfiles(projectPath);
          void statusStore.refreshStatus("full", projectPath);
          void statusStore.refreshStash();
          toast({ tone: "success", title: describeImport(result) });
        }}
      />

      <ConfirmDialog
        open={ctrl.reapplyConfirmOpen}
        title="Re-apply profile?"
        description={
          <p className="muted">
            Re-applying <strong>{activeProfile}</strong> will overwrite live
            harness files on {formatScope(scope)} with the saved profile state.
            Hand edits in those paths cannot be restored.
          </p>
        }
        confirmLabel="Re-apply"
        onConfirm={ctrl.onConfirmReapply}
        onCancel={() => ctrl.setReapplyConfirmOpen(false)}
      />

      <ConfirmDialog
        open={ctrl.pendingRestoreChange !== null}
        title="Restore profile version?"
        description={
          <p className="muted">
            This will overwrite{" "}
            <span className="mono">{ctrl.pendingRestoreChange?.path}</span> with the
            profile&apos;s expected content. Live edits to this file cannot be
            restored.
          </p>
        }
        confirmLabel="Restore"
        onConfirm={ctrl.onConfirmRestoreFile}
        onCancel={() => ctrl.setPendingRestoreChange(null)}
      />

      <FileDiffModal
        open={ctrl.diffFileChange !== null}
        path={ctrl.diffFileChange?.path ?? null}
        resource={ctrl.diffFileChange?.resource ?? null}
        profileName={selectedProfile ?? activeProfile}
        scope={ctrl.view}
        projectPath={projectPath}
        baseUrl={baseUrl}
        token={token}
        onClose={() => ctrl.setDiffFileChange(null)}
      />

      <ConfirmDialog
        open={ctrl.overwriteDialog}
        title="Overwrite owned profile paths?"
        description={
          <p className="muted">
            HarnessTap detected hand-edits inside paths owned by the last apply
            snapshot. Continuing will overwrite those owned keys.
          </p>
        }
        confirmLabel={showReapply ? "Re-apply anyway" : "Apply anyway"}
        tone="destructive"
        onConfirm={ctrl.onConfirmOverwrite}
        onCancel={() => ctrl.setOverwriteDialog(false)}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id="skip-overwrite-prompt"
            checked={ctrl.skipOverwritePrompt}
            onCheckedChange={(value) => ctrl.setSkipOverwritePrompt(value === true)}
          />
          <Label htmlFor="skip-overwrite-prompt" className="font-normal text-muted-foreground">
            Don&apos;t ask again this session
          </Label>
        </div>
      </ConfirmDialog>

      <CutVersionsModal
        open={ctrl.cutModalOpen}
        rows={ctrl.cutRows}
        busy={ctrl.cutBusy}
        onRowsChange={ctrl.setCutRows}
        onConfirm={() => void ctrl.handleCutConfirm()}
        onCancel={ctrl.closeCutModal}
      />

      <ToastRegion />
    </>
  );
}
