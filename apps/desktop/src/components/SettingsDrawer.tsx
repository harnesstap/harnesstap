import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";
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
import { SettingsParitySections } from "./parity/SettingsParitySections";
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
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { HarnessIcon } from "./HarnessIcons";

export interface SettingsDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaved?: () => void;
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
  disabled = false,
  onClose,
  onSaved,
}: SettingsDrawerProps) {
  const [harnesses, setHarnesses] = useState<HarnessCatalogEntry[]>([]);
  const [projectAvailable, setProjectAvailable] = useState(false);
  const [projectReason, setProjectReason] = useState<string | null>(null);
  const [hadExistingOverride, setHadExistingOverride] = useState(false);
  const [hasProjectSection, setHasProjectSection] = useState(false);
  const [baseline, setBaseline] = useState<HarnessSettingsDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<HarnessSettingsDraft>(EMPTY_DRAFT);
  const [showAllHarnesses, setShowAllHarnesses] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const saveGenerationRef = useRef(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const flashSuccess = useCallback(
    (message: string) => {
      clearSuccessTimer();
      setSuccess(message);
      successTimerRef.current = setTimeout(() => {
        setSuccess(null);
        successTimerRef.current = null;
      }, 3000);
    },
    [clearSuccessTimer],
  );

  const resetLocal = useCallback(() => {
    clearSuccessTimer();
    setHarnesses([]);
    setProjectAvailable(false);
    setProjectReason(null);
    setHadExistingOverride(false);
    setHasProjectSection(false);
    setBaseline(EMPTY_DRAFT);
    setDraft(EMPTY_DRAFT);
    setShowAllHarnesses(false);
    setError(null);
    setWarning(null);
    setSuccess(null);
  }, [clearSuccessTimer]);

  const requestClose = useCallback(() => {
    if (busy) {
      return;
    }
    saveGenerationRef.current += 1;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) {
      saveGenerationRef.current += 1;
      setBusy(false);
      clearSuccessTimer();
      setSuccess(null);
      return;
    }
    const loadGeneration = ++saveGenerationRef.current;
    setError(null);
    setWarning(null);
    setSuccess(null);
    clearSuccessTimer();
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
  }, [open, baseUrl, token, projectPath, resetLocal, clearSuccessTimer]);

  useEffect(
    () => () => {
      clearSuccessTimer();
    },
    [clearSuccessTimer],
  );

  const dirty = useMemo(
    () => isHarnessSettingsDirty(baseline, draft),
    [baseline, draft],
  );

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
    setSuccess(null);
    clearSuccessTimer();
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
      flashSuccess("Settings saved.");
      onSavedRef.current?.();
    } catch (saveError) {
      if (generation !== saveGenerationRef.current) {
        return;
      }
      setSuccess(null);
      clearSuccessTimer();
      setError(errorMessage(saveError, "Could not save harness settings."));
    } finally {
      if (generation === saveGenerationRef.current) {
        setBusy(false);
      }
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop create-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog cloud-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        data-testid="settings-drawer"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Preferences</div>
            <h2 id="settings-drawer-title">Settings</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close settings"
            onClick={requestClose}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body cloud-account-body">
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
          {success ? (
            <div className="success-flash" role="status">
              {success}
            </div>
          ) : null}

          {loading && harnesses.length === 0 && !error ? (
            <p className="muted">Loading settings…</p>
          ) : (
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
                  listClassName="settings-alias-list-rows max-h-[180px] h-auto"
                  onToggle={(id) =>
                    setDraft((prev) => ({
                      ...prev,
                      globalAliases: toggleAlias(prev.globalAliases, id),
                    }))}
                />
              </section>

              <SettingsParitySections
                open={open}
                baseUrl={baseUrl}
                token={token}
                projectPath={projectPath}
                disabled={controlsDisabled}
                onSaved={onSaved}
              />

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
                            listClassName="settings-alias-list-rows max-h-[180px] h-auto"
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
          )}
        </div>

        <div className="dialog-actions create-profile-actions">
          <button
            className="btn"
            type="button"
            onClick={requestClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={["btn", "primary", busy ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={() => void onSave()}
            disabled={!canSave}
            aria-busy={busy}
          >
            {busy ? <ButtonSpinner size={16} /> : null}
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
