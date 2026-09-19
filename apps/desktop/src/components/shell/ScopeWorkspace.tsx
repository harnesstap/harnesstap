import { Check, FileDiff, Pencil, Tag, TextQuote, X } from "lucide-react";
import { formatView } from "../../lib/api/scope";
import {
  pendingApprovalsFromTrust,
  shouldShowPendingApprovalsStrip,
} from "../../lib/pending-approvals";
import {
  orderedSwitchSteps,
  SWITCH_STEP_LABELS,
  type ProfileCreateSource,
  type ProfileSwitchStep,
  type ProfileSwitchStepEvent,
} from "../../lib/types";
import type { ScopeController } from "../../state/scope-controller";
import { useStatusStore } from "../../state/status-store";
import { toast } from "../../state/toast-store";
import { EditProfilePane } from "../EditProfilePane";
import { FieldIdentityIcon } from "../FieldIdentityIcon";
import { IconActionButton } from "../IconActionButton";
import { LiveStatePanel } from "../LiveStatePanel";
import { PendingApprovalsStrip } from "../PendingApprovalsStrip";
import { ProfileDeleteControls } from "../parity/ProfileDeleteControls";
import { Banner } from "./Banner";
import { ProfilesRail } from "./ProfilesRail";

const HEADER_ICON_SIZE = 18;

export function stepState(
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

export function isApplyStepActive(events: ProfileSwitchStepEvent[]): boolean {
  return events.some(
    (event) =>
      (event.step === "apply_home" || event.step === "apply_project")
      && event.status === "started",
  );
}

export interface ScopeWorkspaceProps {
  ctrl: ScopeController;
  hasHistory: boolean;
  onBack: () => void;
  libraryReloadKey: number;
  bootstrapBusy: boolean;
  bootstrapError: string | null;
  onDismissBootstrapError: () => void;
  onBootstrap: () => void;
  onOpenPlugin: (pluginName: string) => void;
  onOpenCreateProfile: (source?: ProfileCreateSource, switchAfterCreate?: boolean) => void;
  onOpenStashBrowse: () => void;
  onRequestSignIn: () => void;
  onCreateEnvironment: () => void;
}

/** Profiles rail plus the live-state pane (or the profile editor) for the selected scope. */
export function ScopeWorkspace({
  ctrl,
  hasHistory,
  onBack,
  libraryReloadKey,
  bootstrapBusy,
  bootstrapError,
  onDismissBootstrapError,
  onBootstrap,
  onOpenPlugin,
  onOpenCreateProfile,
  onOpenStashBrowse,
  onRequestSignIn,
  onCreateEnvironment,
}: ScopeWorkspaceProps) {
  const {
    client,
    connected,
    switching,
    scope,
    view,
    selectedProfile,
    selectedProfileSummary,
    selectedIsActive,
    editingProfile,
    activeProfile,
    projectPath,
    preview,
    applyPreview,
  } = ctrl;
  const token = client?.token ?? null;
  const baseUrl = client?.baseUrl ?? null;
  const status = useStatusStore((state) => state.status);
  const statusError = useStatusStore((state) => state.statusError);
  const scopeCanGoBack = Boolean(editingProfile) || hasHistory;
  const actionsEnabled = connected && Boolean(token) && !switching;
  const selectedProfileMetaTags =
    selectedProfileSummary?.tags.filter((tag) => tag !== "profile") ?? [];

  return (
    <>
      <ProfilesRail
        ctrl={ctrl}
        canGoBack={scopeCanGoBack}
        onBack={() => {
          if (editingProfile) {
            ctrl.closeEditProfile();
            return;
          }
          onBack();
        }}
        onOpenCreateProfile={onOpenCreateProfile}
        onOpenStashBrowse={onOpenStashBrowse}
        onRequestSignIn={onRequestSignIn}
      />
      {editingProfile ? (
        <EditProfilePane
          profileName={editingProfile}
          baseUrl={baseUrl}
          token={token}
          projectPath={scope === "project" ? projectPath : null}
          libraryReloadKey={libraryReloadKey}
          disabled={switching}
          onClose={ctrl.closeEditProfile}
          onProfileRenamed={ctrl.renameSelected}
          onMutated={ctrl.maybeAutoReapplyAfterMutation}
          onDeleted={ctrl.handleProfileDeleted}
          onCreateEnvironment={onCreateEnvironment}
          onSuccess={(message) => toast({ tone: "success", title: message })}
          onRequestCut={
            editingProfile && client && token
              ? (name, version) => ctrl.openCutForProfile(name, version)
              : undefined
          }
        />
      ) : (
        <main className="live-pane" aria-label="Live state">
          {bootstrapError ? (
            <Banner tone="error" message={bootstrapError} onDismiss={onDismissBootstrapError} />
          ) : null}

          {shouldShowPendingApprovalsStrip(ctrl.pendingTrust) ? (
            <PendingApprovalsStrip
              items={pendingApprovalsFromTrust(ctrl.pendingTrust)}
              busyRef={ctrl.grantBusyRef}
              onApprove={
                projectPath
                  ? (ref) => {
                      void ctrl.decidePendingApproval("allow", ref);
                    }
                  : undefined
              }
              onDeny={
                projectPath
                  ? (ref) => {
                      void ctrl.decidePendingApproval("deny", ref);
                    }
                  : undefined
              }
            />
          ) : null}

          <div className="live-toolbar">
            <div className="live-toolbar-identity">
              <div className="status-line" aria-live="polite">
                {selectedProfile ? (
                  <>
                    {ctrl.renamingProfile ? (
                      <input
                        ref={ctrl.renameInputRef}
                        className="status-title-input"
                        value={ctrl.renameDraft}
                        onChange={(event) => ctrl.setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void ctrl.commitRenameSelectedProfile();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            ctrl.cancelRenameSelectedProfile();
                          }
                        }}
                        onBlur={() => {
                          if (!ctrl.renameBusy) {
                            void ctrl.commitRenameSelectedProfile();
                          }
                        }}
                        disabled={ctrl.renameBusy}
                        aria-label="Rename selected profile"
                      />
                    ) : (
                      <button
                        type="button"
                        className="status-title"
                        onDoubleClick={ctrl.beginRenameSelectedProfile}
                        disabled={!connected || switching}
                        title="Double-click to rename"
                      >
                        {selectedProfile}
                      </button>
                    )}
                    {selectedIsActive ? <span className="badge">active</span> : null}
                    {selectedProfileSummary?.version ? (
                      <span className="badge badge-meta">
                        v{selectedProfileSummary.version}
                        {selectedProfileSummary.dirty ? "*" : ""}
                      </span>
                    ) : null}
                    {selectedProfileMetaTags.map((tag) => (
                      <span key={tag} className="badge badge-meta">
                        {tag}
                      </span>
                    ))}
                  </>
                ) : (
                  "No profile selected"
                )}
              </div>
              {selectedProfile ? (
                <div className="muted status-subline status-description">
                  <FieldIdentityIcon
                    label="Description"
                    icon={<TextQuote size={14} strokeWidth={2} aria-hidden="true" />}
                  />
                  <span
                    className="status-description-text"
                    title={selectedProfileSummary?.description ?? undefined}
                  >
                    {selectedProfileSummary?.description?.trim() || "\u00A0"}
                  </span>
                </div>
              ) : null}
              {ctrl.renameError ? (
                <div className="muted status-subline status-rename-error">
                  {ctrl.renameError}
                </div>
              ) : null}
            </div>
            {selectedProfile ? (
              <div className="live-toolbar-actions">
                <IconActionButton
                  className="status-edit-action"
                  onClick={() => {
                    if (ctrl.inventoryEditMode) {
                      ctrl.setInventoryEditMode(false);
                      return;
                    }
                    ctrl.setInventoryEditMode(true);
                    ctrl.setPreviewChanges(false);
                  }}
                  disabled={!connected || switching}
                  label={ctrl.inventoryEditMode ? "Done" : "Edit"}
                  title={ctrl.inventoryEditMode ? "Done" : "Edit"}
                  icon={
                    ctrl.inventoryEditMode ? (
                      <Check size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Pencil size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
                    )
                  }
                />
                <IconActionButton
                  className="status-edit-action"
                  onClick={() => {
                    ctrl.setPreviewChanges((value) => !value);
                    ctrl.setInventoryEditMode(false);
                  }}
                  disabled={!connected || switching}
                  label="Preview changes"
                  title="Preview changes"
                  aria-pressed={ctrl.previewChanges}
                  icon={<FileDiff size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
                />
                <IconActionButton
                  className="status-edit-action"
                  onClick={() =>
                    ctrl.openCutForProfile(selectedProfile, selectedProfileSummary?.version ?? "")
                  }
                  disabled={!connected || !token || switching || !selectedProfileSummary?.version}
                  label={`Cut version for ${selectedProfile}`}
                  title={
                    selectedProfileSummary?.dirty
                      ? "Cut unpublished edits to a new version"
                      : "Cut a new version (fork current state)"
                  }
                  icon={<Tag size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
                />
                <div className="live-toolbar-remove">
                  <ProfileDeleteControls
                    profileName={selectedProfile}
                    baseUrl={baseUrl}
                    token={token}
                    disabled={!connected || switching}
                    variant="icon"
                    onDeleted={ctrl.handleProfileDeleted}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {statusError && (
            <Banner
              tone="error"
              message={statusError}
              onRetry={() => void ctrl.refreshStatus("full")}
            />
          )}

          {switching ? (
            <section aria-label="Apply progress">
              <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Applying…</h2>
              <ol className="steps">
                {orderedSwitchSteps(view).map((step) => {
                  const state = stepState(step, ctrl.switchEvents);
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
                      {state === "failed" ? " (failed)" : ""}
                    </li>
                  );
                })}
              </ol>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <IconActionButton
                  label="Cancel"
                  disabled={isApplyStepActive(ctrl.switchEvents)}
                  onClick={() => void ctrl.onCancelSwitch()}
                  icon={<X size={16} strokeWidth={2} aria-hidden="true" />}
                />
              </div>
            </section>
          ) : (
            <LiveStatePanel
              view={view}
              formatView={formatView}
              onOpenPlugin={onOpenPlugin}
              selectedProfile={selectedProfile}
              activeProfile={activeProfile}
              liveContents={status?.contents}
              applyPreview={applyPreview}
              applyPreviewLoading={preview.refreshing && !applyPreview}
              previewRefreshing={preview.refreshing}
              applyPreviewError={ctrl.applyPreviewError}
              onRetryPreview={ctrl.retryPreview}
              onDismissPreviewError={ctrl.dismissPreviewError}
              liveHarnesses={status?.harnesses}
              hasFullHarnessSnapshot={ctrl.hasFullHarnessSnapshot}
              baseUrl={baseUrl}
              token={token}
              bootstrapBusy={bootstrapBusy}
              onBootstrap={onBootstrap}
              onCreateProfileFromProject={() => {
                onOpenCreateProfile("project", true);
              }}
              onEditProfile={
                selectedProfile ? () => ctrl.openEditProfile(selectedProfile) : undefined
              }
              onAddResource={ctrl.handleAddResource}
              onAddAllResources={
                actionsEnabled
                  ? (resources) => ctrl.handleAddAllResources(undefined, resources)
                  : undefined
              }
              onActivateResources={
                actionsEnabled ? () => ctrl.handleActivateResources() : undefined
              }
              onAttachLibraryItem={actionsEnabled ? ctrl.handleAttachLibraryItem : undefined}
              addingResourceKey={ctrl.addingResourceKey}
              addingAllResources={ctrl.addingAllResources}
              activatingResources={ctrl.activatingResources}
              previewChanges={ctrl.previewChanges}
              onClosePreview={() => ctrl.setPreviewChanges(false)}
              editMode={ctrl.inventoryEditMode}
              railPrimaryIsReapply={ctrl.showReapply}
              onCommitManagedChanges={
                actionsEnabled ? ctrl.handleCommitManagedChanges : undefined
              }
              committingManagedChanges={ctrl.committingManagedChanges}
              onOpenResourceInEditor={
                actionsEnabled ? ctrl.handleOpenResourceInEditor : undefined
              }
              onRemoveResourceFromProfile={
                actionsEnabled ? ctrl.handleRemoveResourceFromProfile : undefined
              }
              removingResourceKey={ctrl.removingResourceKey}
              filesRootPath={applyPreview?.files?.root_path ?? null}
              fileChangeBusyPath={ctrl.fileChangeBusyPath}
              fileChangeBusyAction={ctrl.fileChangeBusyAction}
              onOpenFileChange={actionsEnabled ? ctrl.handleOpenFileChange : undefined}
              onDiffFileChange={actionsEnabled ? ctrl.handleDiffFileChange : undefined}
              onAddFileChange={actionsEnabled ? ctrl.handleAddFileChange : undefined}
              onDropFileChange={actionsEnabled ? ctrl.handleDropFileChange : undefined}
              resourceActionError={
                ctrl.resourceActionError && !switching ? ctrl.resourceActionError : null
              }
              onDismissResourceActionError={() => ctrl.setResourceActionError(null)}
              onRecoveryAction={
                actionsEnabled
                  ? (action) => {
                      void ctrl.handleRecoveryAction(action);
                    }
                  : undefined
              }
              recoveryBusy={ctrl.recoveryBusy}
              onSuccess={(message) => toast({ tone: "success", title: message })}
              onLibraryChanged={ctrl.onLibraryChanged}
            />
          )}

          {ctrl.addResourceError && !switching ? (
            <Banner
              tone="error"
              message={ctrl.addResourceError}
              onDismiss={() => ctrl.setAddResourceError(null)}
            />
          ) : null}

          {ctrl.switchError && !switching && (
            <Banner
              tone="error"
              message={ctrl.switchError}
              onRetry={ctrl.onApplyClick}
              onDismiss={() => ctrl.setSwitchError(null)}
            />
          )}
        </main>
      )}
    </>
  );
}
