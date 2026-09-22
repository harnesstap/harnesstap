import { useCallback, useEffect, useState } from "react";
import {
  SETTINGS_TABS,
  SettingsParitySections,
  type SettingsTab,
} from "./parity/SettingsParitySections";
import type { TelemetryConsentStatus } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FullScreenPanel } from "./FullScreenPanel";
import { Presence } from "./motion/Presence";

export interface SettingsDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  inspectProjectPath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
  onTelemetryConsentChange?: (next: TelemetryConsentStatus) => void;
}

const DEFAULT_TAB: SettingsTab = "project";

/** Settings shell: labeled tabs Project | Advanced. Every tab saves inline. */
export function SettingsDrawer({
  open,
  baseUrl,
  token,
  inspectProjectPath,
  disabled = false,
  onClose,
  onSaved,
  onSelectProject,
  onBrowseProject,
  onTelemetryConsentChange,
}: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>(DEFAULT_TAB);
  const [projectDirty, setProjectDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(DEFAULT_TAB);
      return;
    }
    setDiscardOpen(false);
  }, [open]);

  const finishClose = useCallback(() => {
    setDiscardOpen(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (projectDirty) {
      setDiscardOpen(true);
      return;
    }
    finishClose();
  }, [finishClose, projectDirty]);

  return (
    <Presence open={open} exit="m-panel-out">
    <FullScreenPanel
      titleId="settings-drawer-title"
      title="Settings"
      eyebrow="Preferences"
      closeLabel="Close settings"
      onClose={requestClose}
      testId="settings-drawer"
      bodyClassName="cloud-account-body"
    >
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {SETTINGS_TABS.map((entry) => {
              const selected = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${entry.id}`}
                  data-testid={`settings-tab-${entry.id}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${entry.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`settings-panel-${tab}`}
            aria-labelledby={`settings-tab-${tab}`}
            className="settings-tab-panel"
          >
            <SettingsParitySections
              tab={tab}
              open={open}
              baseUrl={baseUrl}
              token={token}
              inspectProjectPath={inspectProjectPath}
              disabled={disabled}
              onSaved={onSaved}
              onSelectProject={onSelectProject}
              onBrowseProject={onBrowseProject}
              onProjectDirtyChange={setProjectDirty}
              onTelemetryConsentChange={onTelemetryConsentChange}
            />
          </div>
    </FullScreenPanel>
    <ConfirmDialog
      open={discardOpen}
      title="Discard changes?"
      description="You have unsaved settings. Close anyway?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={finishClose}
      onCancel={() => setDiscardOpen(false)}
    />
    </Presence>
  );
}
