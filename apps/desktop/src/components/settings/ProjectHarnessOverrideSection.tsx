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

const NO_GLOBAL_SET_NOTE = "Register at least one harness on the Harnesses screen first.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toggleRegistered(ids: string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((entry) => entry !== id)
    : [...ids, id];
}

function harnessListItems(harnesses: HarnessCatalogEntry[]) {
  return harnesses.map((harness) => ({
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
  const [globalRegistered, setGlobalRegistered] = useState<string[]>([]);
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

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setShowAll(false);
    if (!baseUrl || !projectPath) {
      setHarnesses([]);
      setGlobalRegistered([]);
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
        setGlobalRegistered([...payload.global.registered_harnesses]);
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

  const visible = useMemo(
    () => visibleHarnesses(harnesses, { showAll, selectedIds: draft.registered }),
    [harnesses, draft.registered, showAll],
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
    globalRegistered,
    override: draft.override,
    registered: draft.registered,
  });

  const onOverrideChange = (enabled: boolean) => {
    setDraft((prev) => {
      if (!enabled) {
        return { ...prev, override: false };
      }
      if (!hadExistingOverride) {
        return {
          override: true,
          registered: [...globalRegistered],
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
    try {
      const current = await fetchHarnessSettings(baseUrl, token, projectPath);
      const currentRegistered = [...current.global.registered_harnesses];
      if (currentRegistered.length === 0) {
        setGlobalRegistered([]);
        setError(NO_GLOBAL_SET_NOTE);
        return;
      }
      const body: PutHarnessSettingsInput = {
        global: { registered_harnesses: currentRegistered },
        project: draft.override
          ? {
              path: projectPath,
              override: true,
              registered_harnesses: draft.registered,
              materialization_strategy: draft.materialization,
            }
          : { path: projectPath, override: false },
      };
      const result = await saveHarnessSettings(baseUrl, token, body);
      const next = projectOverrideDraftFromPayload(result.project);
      setGlobalRegistered([...result.global.registered_harnesses]);
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
          {globalRegistered.length === 0 ? (
            <p className="field-note muted">{NO_GLOBAL_SET_NOTE}</p>
          ) : null}
          {!draft.override ? (
            <p className="field-note muted">
              This project uses global harness preferences.
            </p>
          ) : (
            <>
              <SelectionList
                title="Registered harnesses"
                idPrefix="project-harnesses"
                emptyLabel="No harnesses available."
                items={harnessListItems(visible)}
                selectedIds={draft.registered}
                disabled={controlsDisabled}
                className="settings-alias-list"
                listClassName="settings-alias-list-rows"
                onToggle={(id) =>
                  setDraft((prev) => ({
                    ...prev,
                    registered: toggleRegistered(prev.registered, id),
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
