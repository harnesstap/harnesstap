import { useEffect, useMemo, useState } from "react";
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
import { fetchHarnessSettings, saveHarnessSettings } from "../../lib/agent-client";
import {
  aliasesExcludingMain,
  canSaveProjectOverride,
  EMPTY_PROJECT_OVERRIDE_DRAFT,
  genericHarnessTooltip,
  isProjectOverrideDirty,
  projectOverrideDraftFromPayload,
  visibleHarnesses,
  type ProjectHarnessOverrideDraft,
} from "../../lib/harness-settings-form";
import type {
  HarnessCatalogEntry,
  MaterializationStrategy,
  PutHarnessSettingsInput,
} from "../../lib/types";
import { ButtonSpinner } from "../ButtonSpinner";
import { HarnessIcon } from "../HarnessIcons";

export interface ProjectHarnessOverrideSectionProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  disabled?: boolean;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const NO_GLOBAL_MAIN_NOTE = "Set up a main harness on the Harnesses screen first.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toggleAlias(aliases: string[], id: string): string[] {
  return aliases.includes(id)
    ? aliases.filter((alias) => alias !== id)
    : [...aliases, id];
}

function aliasListItems(harnesses: HarnessCatalogEntry[], mainId: string) {
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

/**
 * Project-scoped harness override. Saves through `PUT /v1/harness` with the
 * global selection fetched at save time, so a stale draft cannot clobber an
 * edit made on the Harnesses destination.
 */
export function ProjectHarnessOverrideSection({
  open,
  baseUrl,
  token,
  projectPath,
  disabled = false,
  onSaved,
  onDirtyChange,
}: ProjectHarnessOverrideSectionProps) {
  const [harnesses, setHarnesses] = useState<HarnessCatalogEntry[]>([]);
  const [globalMain, setGlobalMain] = useState<string | null>(null);
  const [globalAliases, setGlobalAliases] = useState<string[]>([]);
  const [projectAvailable, setProjectAvailable] = useState(false);
  const [projectReason, setProjectReason] = useState<string | null>(null);
  const [hadExistingOverride, setHadExistingOverride] = useState(false);
  const [baseline, setBaseline] = useState<ProjectHarnessOverrideDraft>(
    EMPTY_PROJECT_OVERRIDE_DRAFT,
  );
  const [draft, setDraft] = useState<ProjectHarnessOverrideDraft>(
    EMPTY_PROJECT_OVERRIDE_DRAFT,
  );
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setWarning(null);
    setShowAll(false);
    if (!baseUrl || !projectPath) {
      setHarnesses([]);
      setGlobalMain(null);
      setGlobalAliases([]);
      setProjectAvailable(false);
      setProjectReason(null);
      setHadExistingOverride(false);
      setBaseline(EMPTY_PROJECT_OVERRIDE_DRAFT);
      setDraft(EMPTY_PROJECT_OVERRIDE_DRAFT);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchHarnessSettings(baseUrl, token, projectPath)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setHarnesses(payload.harnesses);
        setGlobalMain(payload.global.main_harness);
        setGlobalAliases([...payload.global.alias_harnesses]);
        setProjectAvailable(payload.project?.available === true);
        setProjectReason(payload.project?.reason ?? null);
        setHadExistingOverride(payload.project?.override === true);
        const next = projectOverrideDraftFromPayload(payload.project);
        setBaseline(next);
        setDraft(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
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
  }, [open, baseUrl, token, projectPath]);

  const dirty = useMemo(() => isProjectOverrideDirty(baseline, draft), [baseline, draft]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const selectedIds = useMemo(
    () => [draft.main, ...draft.aliases].filter(Boolean),
    [draft.aliases, draft.main],
  );
  const visible = useMemo(
    () => visibleHarnesses(harnesses, { showAll, selectedIds }),
    [harnesses, selectedIds, showAll],
  );
  const aliasItems = useMemo(
    () => aliasListItems(visible, draft.main),
    [draft.main, visible],
  );

  const controlsDisabled = disabled || busy || loading;
  const canSave = canSaveProjectOverride({
    dirty,
    busy,
    loading,
    disabled,
    baseUrl,
    projectPath,
    projectAvailable,
    globalMain,
    override: draft.override,
    main: draft.main,
  });

  const setMain = (main: string) => {
    setDraft((prev) => ({
      ...prev,
      main,
      aliases: aliasesExcludingMain(prev.aliases, main),
    }));
  };

  const onOverrideChange = (enabled: boolean) => {
    setDraft((prev) => {
      if (!enabled) {
        return { ...prev, override: false };
      }
      if (!hadExistingOverride) {
        const main = globalMain ?? "";
        return {
          override: true,
          main,
          aliases: aliasesExcludingMain(globalAliases, main),
          materialization: "symlink-preferred",
        };
      }
      return { ...prev, override: true };
    });
  };

  const onCancel = () => {
    setDraft(baseline);
    setError(null);
  };

  const onSave = async () => {
    if (!baseUrl || !projectPath || !canSave) {
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const current = await fetchHarnessSettings(baseUrl, token, projectPath);
      const currentMain = current.global.main_harness;
      if (!currentMain) {
        setGlobalMain(null);
        setError(NO_GLOBAL_MAIN_NOTE);
        return;
      }
      const body: PutHarnessSettingsInput = {
        global: {
          main_harness: currentMain,
          alias_harnesses: [...current.global.alias_harnesses],
        },
        project: draft.override
          ? {
              path: projectPath,
              override: true,
              main_harness: draft.main,
              alias_harnesses: draft.aliases,
              materialization_strategy: draft.materialization,
            }
          : { path: projectPath, override: false },
      };
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
      const next = projectOverrideDraftFromPayload(result.project);
      setGlobalMain(result.global.main_harness);
      setGlobalAliases([...result.global.alias_harnesses]);
      setHadExistingOverride(result.project?.override === true);
      if (result.project) {
        setProjectAvailable(result.project.available === true);
        setProjectReason(result.project.reason ?? null);
      }
      setBaseline(next);
      setDraft(next);
      onSaved?.();
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Could not save harness override."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" data-testid="project-harness-override">
      <h3>Harness override</h3>
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
      {!projectPath ? (
        <p className="muted">Select a project to set a harness override.</p>
      ) : loading && harnesses.length === 0 && !error ? (
        <p className="muted">Loading harness override…</p>
      ) : !projectAvailable ? (
        <>
          <div className="switch-after-create settings-override-toggle flex items-center gap-2">
            <Switch id="settings-project-override-unavailable" checked={false} disabled />
            <Label htmlFor="settings-project-override-unavailable">
              Use project override
            </Label>
          </div>
          <p className="field-note muted">
            {projectReason || "Project override is unavailable for this project."}
          </p>
        </>
      ) : (
        <>
          <div className="switch-after-create settings-override-toggle flex items-center gap-2">
            <Switch
              id="settings-project-override"
              checked={draft.override}
              onCheckedChange={onOverrideChange}
              disabled={controlsDisabled}
            />
            <Label htmlFor="settings-project-override">Use project override</Label>
          </div>
          {!globalMain ? (
            <p className="field-note muted">{NO_GLOBAL_MAIN_NOTE}</p>
          ) : null}
          {!draft.override ? (
            <p className="field-note muted">
              This project uses global harness preferences.
            </p>
          ) : (
            <>
              <div className="form-field">
                <Label htmlFor="settings-project-main">Main harness</Label>
                <Select
                  value={draft.main || undefined}
                  onValueChange={setMain}
                  disabled={controlsDisabled}
                >
                  <SelectTrigger id="settings-project-main" className="w-full">
                    <SelectValue placeholder="Select a harness…" />
                  </SelectTrigger>
                  <SelectContent>
                    {visible.map((harness) => (
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
                idPrefix="project-aliases"
                emptyLabel="No harnesses available."
                items={aliasItems}
                selectedIds={draft.aliases}
                disabled={controlsDisabled}
                className="settings-alias-list"
                listClassName="settings-alias-list-rows"
                onToggle={(id) =>
                  setDraft((prev) => ({
                    ...prev,
                    aliases: toggleAlias(prev.aliases, id),
                  }))}
              />

              <div className="switch-after-create settings-show-all flex items-center gap-2">
                <Switch
                  id="settings-show-all-harnesses"
                  checked={showAll}
                  onCheckedChange={setShowAll}
                  disabled={controlsDisabled}
                />
                <Label htmlFor="settings-show-all-harnesses">Show all harnesses</Label>
              </div>

              <div className="form-field">
                <Label htmlFor="settings-materialization">Materialization</Label>
                <Select
                  value={draft.materialization}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      materialization: value as MaterializationStrategy,
                    }))}
                  disabled={controlsDisabled}
                >
                  <SelectTrigger id="settings-materialization" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="symlink-preferred">Symlink preferred</SelectItem>
                    <SelectItem value="copy">Copy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="field-note muted">
                Saving rematerializes alias harness files from the main harness on disk.
              </p>
            </>
          )}
          <div className="project-config-actions">
            <button
              className="btn"
              type="button"
              onClick={onCancel}
              disabled={!dirty || busy}
            >
              <X size={16} aria-hidden />
              Cancel
            </button>
            <button
              className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              data-testid="settings-harness-save"
              onClick={() => void onSave()}
              disabled={!canSave}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : <Save size={16} aria-hidden />}
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
