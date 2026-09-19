import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Save, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectionList } from "@/components/ui/selection-list";
import { Switch } from "@/components/ui/switch";
import {
  fetchHarnessSettings,
  saveHarnessSettings,
} from "../lib/agent-client";
import {
  SETTINGS_TABS,
  SettingsParitySections,
  type SettingsTab,
} from "./parity/SettingsParitySections";
import {
  aliasesExcludingMain,
  canSaveHarnessSettings,
  genericHarnessTooltip,
  isHarnessSettingsDirty,
  visibleHarnesses,
  type HarnessSettingsDraft,
} from "../lib/harness-settings-form";
import type {
  HarnessCatalogEntry,
  HarnessSettingsPayload,
  MaterializationStrategy,
  PutHarnessSettingsInput,
  TelemetryConsentStatus,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { FullScreenPanel } from "./FullScreenPanel";
import { HarnessIcon } from "./HarnessIcons";
import { Presence } from "./motion/Presence";

export interface SettingsDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  inspectProjectPath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
  onTelemetryConsentChange?: (next: TelemetryConsentStatus) => void;
}

const EMPTY_DRAFT: HarnessSettingsDraft = {
  globalMain: "",
  globalAliases: [],
  projectOverride: false,
  projectMain: "",
  projectAliases: [],
  materialization: "symlink-preferred",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function draftFromPayload(payload: HarnessSettingsPayload): HarnessSettingsDraft {
  const override = payload.project?.override === true;
  return {
    globalMain: payload.global.main_harness ?? "",
    globalAliases: [...payload.global.alias_harnesses],
    projectOverride: override,
    projectMain: override ? (payload.project?.main_harness ?? "") : "",
    projectAliases: override ? [...(payload.project?.alias_harnesses ?? [])] : [],
    materialization: override
      ? (payload.project?.materialization_strategy ?? "symlink-preferred")
      : "symlink-preferred",
  };
}

function toggleAlias(aliases: string[], id: string): string[] {
  return aliases.includes(id)
    ? aliases.filter((alias) => alias !== id)
    : [...aliases, id];
}

function aliasListItems(
  harnesses: HarnessCatalogEntry[],
  mainId: string,
) {
  return harnesses
    .filter((harness) => harness.id !== mainId)
    .map((harness) => ({
      id: harness.id,
      name: harness.name,
      leading: <HarnessIcon id={harness.id} />,
      trailing: !harness.supported ? (
        <span
          className="harness-generic-info"
          title={genericHarnessTooltip(harness.supports)}
          aria-label={genericHarnessTooltip(harness.supports)}
          role="img"
        >
          <Info aria-hidden="true" size={14} strokeWidth={2} />
        </span>
      ) : undefined,
    }));
}

export function SettingsDrawer({
  open,
  baseUrl,
  token,
  projectPath,
  inspectProjectPath,
  disabled = false,
  onClose,
  onSaved,
  onSelectProject,
  onBrowseProject,
  onTelemetryConsentChange,
}: SettingsDrawerProps) {
  const [harnesses, setHarnesses] = useState<HarnessCatalogEntry[]>([]);
  const [projectAvailable, setProjectAvailable] = useState(false);
  const [projectReason, setProjectReason] = useState<string | null>(null);
  const [hadExistingOverride, setHadExistingOverride] = useState(false);
  const [hasProjectSection, setHasProjectSection] = useState(false);
  const [baseline, setBaseline] = useState<HarnessSettingsDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<HarnessSettingsDraft>(EMPTY_DRAFT);
  const [showAllHarnesses, setShowAllHarnesses] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("harnesses");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const saveGenerationRef = useRef(0);

  const resetLocal = useCallback(() => {
    setHarnesses([]);
    setProjectAvailable(false);
    setProjectReason(null);
    setHadExistingOverride(false);
    setHasProjectSection(false);
    setBaseline(EMPTY_DRAFT);
    setDraft(EMPTY_DRAFT);
    setShowAllHarnesses(false);
    setTab("harnesses");
    setError(null);
    setWarning(null);
    setProjectDirty(false);
    setDiscardOpen(false);
  }, []);

  const dirty = useMemo(
    () => isHarnessSettingsDirty(baseline, draft),
    [baseline, draft],
  );
  const closeIsDirty = dirty || projectDirty;

  const finishClose = useCallback(() => {
    saveGenerationRef.current += 1;
    setDiscardOpen(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (busy) {
      return;
    }
    if (closeIsDirty) {
      setDiscardOpen(true);
      return;
    }
    finishClose();
  }, [busy, closeIsDirty, finishClose]);

  useEffect(() => {
    if (!open) {
      saveGenerationRef.current += 1;
      setBusy(false);
      setDiscardOpen(false);
      return;
    }
    const loadGeneration = ++saveGenerationRef.current;
    setError(null);
    setWarning(null);
    setShowAllHarnesses(false);
    if (!baseUrl) {
      resetLocal();
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchHarnessSettings(baseUrl, token, projectPath)
      .then((payload) => {
        if (cancelled || loadGeneration !== saveGenerationRef.current) {
          return;
        }
        const next = draftFromPayload(payload);
        setHarnesses(payload.harnesses);
        setHasProjectSection(payload.project !== undefined);
        setProjectAvailable(payload.project?.available === true);
        setProjectReason(payload.project?.reason ?? null);
        setHadExistingOverride(payload.project?.override === true);
        setBaseline(next);
        setDraft(next);
      })
      .catch((loadError) => {
        if (!cancelled && loadGeneration === saveGenerationRef.current) {
          resetLocal();
          setError(errorMessage(loadError, "Could not load harness settings."));
        }
      })
      .finally(() => {
        if (!cancelled && loadGeneration === saveGenerationRef.current) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token, projectPath, resetLocal]);

  useEffect(() => {
    if (open) {
      setTab("harnesses");
    }
  }, [open]);

  const globalSelectedIds = useMemo(
    () => [draft.globalMain, ...draft.globalAliases].filter(Boolean),
    [draft.globalAliases, draft.globalMain],
  );

  const projectSelectedIds = useMemo(
    () => [draft.projectMain, ...draft.projectAliases].filter(Boolean),
    [draft.projectAliases, draft.projectMain],
  );

  const globalVisible = useMemo(
    () =>
      visibleHarnesses(harnesses, {
        showAll: showAllHarnesses,
        selectedIds: globalSelectedIds,
      }),
    [globalSelectedIds, harnesses, showAllHarnesses],
  );

  const projectVisible = useMemo(
    () =>
      visibleHarnesses(harnesses, {
        showAll: showAllHarnesses,
        selectedIds: projectSelectedIds,
      }),
    [harnesses, projectSelectedIds, showAllHarnesses],
  );

  const globalAliasItems = useMemo(
    () => aliasListItems(globalVisible, draft.globalMain),
    [draft.globalMain, globalVisible],
  );

  const projectAliasItems = useMemo(
    () => aliasListItems(projectVisible, draft.projectMain),
    [draft.projectMain, projectVisible],
  );

  const controlsDisabled = disabled || busy || loading;
  const canSave = canSaveHarnessSettings({
    dirty,
    busy,
    loading,
    disabled,
    globalMain: draft.globalMain,
    baseUrl,
    projectOverride: draft.projectOverride,
    projectAvailable,
    projectMain: draft.projectMain,
  });

  const setGlobalMain = (main: string) => {
    setDraft((prev) => ({
      ...prev,
      globalMain: main,
      globalAliases: aliasesExcludingMain(prev.globalAliases, main),
    }));
  };

  const setProjectMain = (main: string) => {
    setDraft((prev) => ({
      ...prev,
      projectMain: main,
      projectAliases: aliasesExcludingMain(prev.projectAliases, main),
    }));
  };

  const onOverrideChange = (enabled: boolean) => {
    setDraft((prev) => {
      if (!enabled) {
        return { ...prev, projectOverride: false };
      }
      if (!hadExistingOverride) {
        return {
          ...prev,
          projectOverride: true,
          projectMain: prev.globalMain,
          projectAliases: aliasesExcludingMain(prev.globalAliases, prev.globalMain),
          materialization: "symlink-preferred",
        };
      }
      return { ...prev, projectOverride: true };
    });
  };

  const onSave = async () => {
    if (!baseUrl || !canSave) {
      return;
    }
    const generation = ++saveGenerationRef.current;
    setBusy(true);
    setError(null);
    setWarning(null);
    const body: PutHarnessSettingsInput = {
      global: {
        main_harness: draft.globalMain,
        alias_harnesses: draft.globalAliases,
      },
    };
    if (projectPath && hasProjectSection && projectAvailable) {
      body.project = draft.projectOverride
        ? {
            path: projectPath,
            override: true,
            main_harness: draft.projectMain,
            alias_harnesses: draft.projectAliases,
            materialization_strategy: draft.materialization,
          }
        : {
            path: projectPath,
            override: false,
          };
    }
    try {
      const result = await saveHarnessSettings(baseUrl, token, body);
      if (generation !== saveGenerationRef.current) {
        return;
      }
      if (result.mirror_error) {
        setWarning(result.mirror_error);
      } else if (result.mirror?.surface_warnings?.length) {
        setWarning(
          result.mirror.surface_warnings
            .map((entry) => `${entry.harness}: ${entry.message}`)
            .join(" "),
        );
      }
      const next = draftFromPayload({
        global: result.global,
        project: result.project,
        harnesses,
      });
      if (result.project) {
        setHasProjectSection(true);
        setProjectAvailable(result.project.available === true);
        setProjectReason(result.project.reason ?? null);
        setHadExistingOverride(result.project.override === true);
      } else if (!projectPath) {
        setHasProjectSection(false);
        setHadExistingOverride(false);
      } else {
        setHadExistingOverride(false);
      }
      setBaseline(next);
      setDraft(next);
      onSavedRef.current?.();
    } catch (saveError) {
      if (generation !== saveGenerationRef.current) {
        return;
      }
      setError(errorMessage(saveError, "Could not save harness settings."));
    } finally {
      if (generation === saveGenerationRef.current) {
        setBusy(false);
      }
    }
  };

  return (
    <Presence open={open} exit="m-panel-out">
    <FullScreenPanel
      titleId="settings-drawer-title"
      title="Settings"
      eyebrow="Preferences"
      closeLabel="Close settings"
      closeDisabled={busy}
      onClose={requestClose}
      testId="settings-drawer"
      bodyClassName="cloud-account-body"
      actions={
        tab === "harnesses" ? (
          <>
            <button
              className="btn"
              type="button"
              onClick={requestClose}
              disabled={busy}
            >
              <X size={16} aria-hidden />
              Cancel
            </button>
            <button
              className={["btn", "primary", busy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              data-testid="settings-harness-save"
              onClick={() => void onSave()}
              disabled={!canSave}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : <Save size={16} aria-hidden />}
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        ) : undefined
      }
    >
          {error ? (
            <div className="banner error" role="alert">
              {error}
            </div>
          ) : null}
          {warning ? (
            <div className="banner" role="status">
              {warning}
            </div>
          ) : null}

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
                  disabled={busy}
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
          {tab === "harnesses" && loading && harnesses.length === 0 && !error ? (
            <p className="muted">Loading settings…</p>
          ) : tab === "harnesses" ? (
            <>
              <section className="settings-section">
                <h3>Global harness</h3>
                <div className="form-field">
                  <Label htmlFor="settings-global-main">Main harness</Label>
                  <Select
                    value={draft.globalMain || undefined}
                    onValueChange={setGlobalMain}
                    disabled={controlsDisabled}
                  >
                    <SelectTrigger id="settings-global-main" className="w-full">
                      <SelectValue placeholder="Select a harness…" />
                    </SelectTrigger>
                    <SelectContent>
                      {globalVisible.map((harness) => (
                        <SelectItem key={harness.id} value={harness.id}>
                          <HarnessIcon id={harness.id} />
                          {harness.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <SelectionList
                  title="Alias harnesses"
                  idPrefix="global-aliases"
                  emptyLabel="No harnesses available."
                  items={globalAliasItems}
                  selectedIds={draft.globalAliases}
                  disabled={controlsDisabled}
                  className="settings-alias-list"
                  listClassName="settings-alias-list-rows"
                  onToggle={(id) =>
                    setDraft((prev) => ({
                      ...prev,
                      globalAliases: toggleAlias(prev.globalAliases, id),
                    }))}
                />
              </section>

              <div className="switch-after-create settings-show-all flex items-center gap-2">
                <Switch
                  id="settings-show-all-harnesses"
                  checked={showAllHarnesses}
                  onCheckedChange={setShowAllHarnesses}
                  disabled={controlsDisabled}
                />
                <Label htmlFor="settings-show-all-harnesses">
                  Show all harnesses
                </Label>
              </div>

              {hasProjectSection ? (
                <section className="settings-section">
                  <h3>Project override</h3>
                  {!projectAvailable ? (
                    <>
                      <div className="switch-after-create settings-override-toggle flex items-center gap-2">
                        <Switch
                          id="settings-project-override-unavailable"
                          checked={false}
                          disabled
                        />
                        <Label htmlFor="settings-project-override-unavailable">
                          Use project override
                        </Label>
                      </div>
                      <p className="field-note muted">
                        {projectReason
                          || "Project override is unavailable for this project."}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="switch-after-create settings-override-toggle flex items-center gap-2">
                        <Switch
                          id="settings-project-override"
                          checked={draft.projectOverride}
                          onCheckedChange={onOverrideChange}
                          disabled={controlsDisabled}
                        />
                        <Label htmlFor="settings-project-override">
                          Use project override
                        </Label>
                      </div>
                      {!draft.projectOverride ? (
                        <p className="field-note muted">
                          This project uses global harness preferences.
                        </p>
                      ) : (
                        <>
                          <div className="form-field">
                            <Label htmlFor="settings-project-main">
                              Main harness
                            </Label>
                            <Select
                              value={draft.projectMain || undefined}
                              onValueChange={setProjectMain}
                              disabled={controlsDisabled}
                            >
                              <SelectTrigger
                                id="settings-project-main"
                                className="w-full"
                              >
                                <SelectValue placeholder="Select a harness…" />
                              </SelectTrigger>
                              <SelectContent>
                                {projectVisible.map((harness) => (
                                  <SelectItem
                                    key={harness.id}
                                    value={harness.id}
                                  >
                                    <HarnessIcon id={harness.id} />
                                    {harness.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <SelectionList
                            title="Alias harnesses"
                            idPrefix="project-aliases"
                            emptyLabel="No harnesses available."
                            items={projectAliasItems}
                            selectedIds={draft.projectAliases}
                            disabled={controlsDisabled}
                            className="settings-alias-list"
                            listClassName="settings-alias-list-rows"
                            onToggle={(id) =>
                              setDraft((prev) => ({
                                ...prev,
                                projectAliases: toggleAlias(
                                  prev.projectAliases,
                                  id,
                                ),
                              }))}
                          />

                          <div className="form-field">
                            <Label htmlFor="settings-materialization">
                              Materialization
                            </Label>
                            <Select
                              value={draft.materialization}
                              onValueChange={(value) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  materialization:
                                    value as MaterializationStrategy,
                                }))}
                              disabled={controlsDisabled}
                            >
                              <SelectTrigger
                                id="settings-materialization"
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="symlink-preferred">
                                  Symlink preferred
                                </SelectItem>
                                <SelectItem value="copy">Copy</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <p className="field-note muted">
                            Saving rematerializes alias harness files from the
                            main harness on disk.
                          </p>
                        </>
                      )}
                    </>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
          <div hidden={tab === "harnesses"}>
            <SettingsParitySections
              tab={tab}
              open={open}
              baseUrl={baseUrl}
              token={token}
              inspectProjectPath={inspectProjectPath}
              disabled={controlsDisabled}
              onSaved={onSaved}
              onSelectProject={onSelectProject}
              onBrowseProject={onBrowseProject}
              onProjectDirtyChange={setProjectDirty}
              onTelemetryConsentChange={onTelemetryConsentChange}
            />
          </div>
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
