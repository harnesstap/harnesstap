import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHarnessSettings,
  saveHarnessSettings,
} from "../lib/agent-client";
import {
  aliasesExcludingMain,
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
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const resetLocal = useCallback(() => {
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
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
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
        if (cancelled) {
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
        if (!cancelled) {
          resetLocal();
          setError(errorMessage(loadError, "Could not load harness settings."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token, projectPath, resetLocal]);

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

  const controlsDisabled = disabled || busy || loading;
  const canSave =
    dirty && !busy && !loading && !disabled && Boolean(draft.globalMain) && Boolean(baseUrl);

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
      setError(errorMessage(saveError, "Could not save harness settings."));
    } finally {
      setBusy(false);
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
          onClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog cloud-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
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
            onClick={onClose}
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

          {loading && harnesses.length === 0 && !error ? (
            <p className="muted">Loading settings…</p>
          ) : (
            <>
              <section className="settings-section">
                <h3>Global harness</h3>
                <label className="form-field">
                  <span>Main harness</span>
                  <select
                    value={draft.globalMain}
                    onChange={(event) => setGlobalMain(event.target.value)}
                    disabled={controlsDisabled}
                  >
                    <option value="">Select a harness…</option>
                    {globalVisible.map((harness) => (
                      <option key={harness.id} value={harness.id}>
                        {harness.name}
                      </option>
                    ))}
                  </select>
                </label>

                <AliasHarnessList
                  title="Alias harnesses"
                  harnesses={globalVisible}
                  mainId={draft.globalMain}
                  selectedIds={draft.globalAliases}
                  disabled={controlsDisabled}
                  onToggle={(id) =>
                    setDraft((prev) => ({
                      ...prev,
                      globalAliases: toggleAlias(prev.globalAliases, id),
                    }))}
                />
              </section>

              <label className="switch-after-create settings-show-all">
                <input
                  type="checkbox"
                  checked={showAllHarnesses}
                  onChange={(event) => setShowAllHarnesses(event.target.checked)}
                  disabled={controlsDisabled}
                />
                Show all harnesses
              </label>

              {hasProjectSection ? (
                <section className="settings-section">
                  <h3>Project override</h3>
                  {!projectAvailable ? (
                    <>
                      <label className="switch-after-create settings-override-toggle">
                        <input type="checkbox" checked={false} disabled />
                        Use project override
                      </label>
                      <p className="field-note muted">
                        {projectReason
                          || "Project override is unavailable for this project."}
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="switch-after-create settings-override-toggle">
                        <input
                          type="checkbox"
                          checked={draft.projectOverride}
                          onChange={(event) =>
                            onOverrideChange(event.target.checked)}
                          disabled={controlsDisabled}
                        />
                        Use project override
                      </label>
                      {!draft.projectOverride ? (
                        <p className="field-note muted">
                          This project uses global harness preferences.
                        </p>
                      ) : (
                        <>
                          <label className="form-field">
                            <span>Main harness</span>
                            <select
                              value={draft.projectMain}
                              onChange={(event) =>
                                setProjectMain(event.target.value)}
                              disabled={controlsDisabled}
                            >
                              <option value="">Select a harness…</option>
                              {projectVisible.map((harness) => (
                                <option key={harness.id} value={harness.id}>
                                  {harness.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <AliasHarnessList
                            title="Alias harnesses"
                            harnesses={projectVisible}
                            mainId={draft.projectMain}
                            selectedIds={draft.projectAliases}
                            disabled={controlsDisabled}
                            onToggle={(id) =>
                              setDraft((prev) => ({
                                ...prev,
                                projectAliases: toggleAlias(
                                  prev.projectAliases,
                                  id,
                                ),
                              }))}
                          />

                          <label className="form-field">
                            <span>Materialization</span>
                            <select
                              value={draft.materialization}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  materialization: event.target
                                    .value as MaterializationStrategy,
                                }))}
                              disabled={controlsDisabled}
                            >
                              <option value="symlink-preferred">
                                Symlink preferred
                              </option>
                              <option value="copy">Copy</option>
                            </select>
                          </label>

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
            onClick={onClose}
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

interface AliasHarnessListProps {
  title: string;
  harnesses: HarnessCatalogEntry[];
  mainId: string;
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}

function AliasHarnessList({
  title,
  harnesses,
  mainId,
  selectedIds,
  disabled,
  onToggle,
}: AliasHarnessListProps) {
  const rows = harnesses.filter((harness) => harness.id !== mainId);
  return (
    <fieldset className="selection-list settings-alias-list" disabled={disabled}>
      <legend>{title}</legend>
      <div className="selection-list-rows">
        {rows.length === 0 ? (
          <p className="muted">No harnesses available.</p>
        ) : (
          rows.map((harness) => (
            <label key={harness.id} className="selection-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(harness.id)}
                onChange={() => onToggle(harness.id)}
              />
              <span>
                <strong>{harness.name}</strong>
                {!harness.supported ? <small>Registered</small> : null}
              </span>
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
}
