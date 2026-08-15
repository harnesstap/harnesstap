import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchApplyPreview } from "../../lib/agent-client";
import type { ProfileApplyPreview } from "../../lib/types";
import {
  applyPluginDialogTitle,
  applyPluginHelperCopy,
  applyPluginProfileGlobalWarning,
  applyPluginProjectMissing,
} from "../../lib/apply-plugin-confirm";
import {
  AgentApiError,
  postApply,
  type ApplyOnConflict,
  type ApplyPluginResult,
  type ApplyPluginScope,
} from "../../lib/api/apply-plugin";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";

export interface ApplyPluginDrawerProps {
  open: boolean;
  onClose: () => void;
  pluginName: string;
  isProfile: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  onSuccess: (message: string) => void;
  onProfilesChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ApplyPluginDrawer({
  open,
  onClose,
  pluginName,
  isProfile,
  baseUrl,
  token,
  projectPath,
  onSuccess,
  onProfilesChanged,
  onBusyChange,
  disabled,
}: ApplyPluginDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<ApplyPluginScope>("home");
  const [onConflict, setOnConflict] = useState<ApplyOnConflict>("replace");
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState<ProfileApplyPreview | null>(null);
  const [dryRunPreview, setDryRunPreview] = useState<ApplyPluginResult | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [skipOverwritePrompt, setSkipOverwritePrompt] = useState(false);
  const skipOverwriteRef = useRef(false);

  const applyLocked = Boolean(disabled) || busy;
  const projectMissing = applyPluginProjectMissing(scope, projectPath);
  const canApply =
    Boolean(baseUrl)
    && Boolean(token)
    && pluginName.trim().length > 0
    && !applyLocked
    && !projectMissing;
  const profileGlobalWarning = applyPluginProfileGlobalWarning(isProfile, scope);

  useEffect(() => {
    skipOverwriteRef.current = skipOverwritePrompt;
  }, [skipOverwritePrompt]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setScope("home");
    setOnConflict("replace");
    setError(null);
    setProfilePreview(null);
    setDryRunPreview(null);
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, pluginName]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !overwriteOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open, overwriteOpen]);

  const runApply = async (confirmOwnedOverwrite: boolean) => {
    if (!baseUrl || !token || !pluginName.trim()) {
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const result = await postApply(baseUrl, token, {
        plugins: [pluginName],
        scope,
        onConflict,
        dryRun: false,
        confirmOwnedOverwrite,
        ...(scope === "project" && projectPath ? { projectPath } : {}),
      });
      if (result.cancelled) {
        setError("Apply cancelled.");
        return;
      }
      const where = scope === "home" ? "Global" : "Project";
      onSuccess(`Applied ${pluginName} to ${where}`);
      onProfilesChanged?.();
      onClose();
    } catch (applyError: unknown) {
      if (
        applyError instanceof AgentApiError
        && applyError.code === "owned_overwrite_confirmation_required"
        && onConflict === "replace"
        && !confirmOwnedOverwrite
      ) {
        if (skipOverwriteRef.current) {
          setBusy(false);
          onBusyChange?.(false);
          await runApply(true);
          return;
        }
        setOverwriteOpen(true);
        return;
      }
      setError(errorMessage(applyError, "Could not apply plugin"));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const onPreview = async () => {
    if (!baseUrl || !token || !pluginName.trim()) {
      return;
    }
    setPreviewBusy(true);
    setError(null);
    setProfilePreview(null);
    setDryRunPreview(null);
    try {
      if (isProfile) {
        const preview = await fetchApplyPreview(baseUrl, token, {
          profile: pluginName,
          scope: scope === "home" ? "home" : "project",
          ...(scope === "project" && projectPath ? { projectPath } : {}),
        });
        setProfilePreview(preview);
        return;
      }
      const result = await postApply(baseUrl, token, {
        plugins: [pluginName],
        scope,
        onConflict,
        dryRun: true,
        ...(scope === "project" && projectPath ? { projectPath } : {}),
      });
      setDryRunPreview(result);
    } catch (previewError: unknown) {
      setError(errorMessage(previewError, "Could not preview apply"));
    } finally {
      setPreviewBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="dialog-backdrop create-profile-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) {
            onClose();
          }
        }}
      >
        <div
          className="dialog create-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-plugin-title"
        >
          <div className="create-profile-header">
            <div>
              <h2 id="apply-plugin-title">{applyPluginDialogTitle(pluginName)}</h2>
              <p className="muted">{applyPluginHelperCopy()}</p>
            </div>
            <button
              ref={closeRef}
              className="icon-btn"
              type="button"
              aria-label="Close"
              onClick={onClose}
              disabled={busy}
            >
              ×
            </button>
          </div>

          <div className="create-profile-body">
            {error ? (
              <div className="banner error" role="alert">
                {error}
              </div>
            ) : null}

            <fieldset className="form-field gap-1.5">
              <legend>Scope</legend>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as ApplyPluginScope)}
                disabled={applyLocked}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="home" id="apply-scope-home" />
                  <Label htmlFor="apply-scope-home">Global</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="project" id="apply-scope-project" />
                  <Label htmlFor="apply-scope-project">Project</Label>
                </div>
              </RadioGroup>
            </fieldset>

            <fieldset className="form-field gap-1.5">
              <legend>On existing files</legend>
              <RadioGroup
                value={onConflict}
                onValueChange={(value) => setOnConflict(value as ApplyOnConflict)}
                disabled={applyLocked}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="replace" id="apply-conflict-replace" />
                  <Label htmlFor="apply-conflict-replace">Replace</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="skip" id="apply-conflict-skip" />
                  <Label htmlFor="apply-conflict-skip">Skip</Label>
                </div>
              </RadioGroup>
            </fieldset>

            {projectMissing ? (
              <p className="muted">Choose a project directory to apply to a project.</p>
            ) : null}
            {profileGlobalWarning ? (
              <p className="muted">{profileGlobalWarning}</p>
            ) : null}

            {profilePreview ? (
              <p className="muted">
                Preview: {profilePreview.files.expected_count} expected files,{" "}
                {profilePreview.files.changes.length} changes
                {profilePreview.warning ? ` — ${profilePreview.warning}` : ""}.
              </p>
            ) : null}
            {dryRunPreview ? (
              <p className="muted">
                Preview: {(dryRunPreview.plugins ?? [pluginName]).join(", ")}
                {dryRunPreview.platforms
                  ? ` — ${dryRunPreview.platforms
                      .map((row) => `${row.platform} (${row.files?.length ?? 0})`)
                      .join(", ")}`
                  : ""}
                {dryRunPreview.harnesses?.length
                  ? ` — ${dryRunPreview.harnesses.join(", ")}`
                  : ""}
                {dryRunPreview.files?.length
                  ? ` — ${dryRunPreview.files.length} files`
                  : ""}
              </p>
            ) : null}
          </div>

          <div className="dialog-actions">
            <button className="btn" type="button" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void onPreview()}
              disabled={!canApply || previewBusy}
            >
              {previewBusy ? <ButtonSpinner size={16} /> : null}
              Preview
            </button>
            <button
              className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              disabled={!canApply}
              aria-busy={busy}
              onClick={() => void runApply(false)}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={overwriteOpen}
        title="Overwrite owned profile paths?"
        description="HarnessTap detected hand-edits inside paths owned by the last apply snapshot. Continuing will overwrite those owned keys."
        confirmLabel="Apply anyway"
        confirmBusy={busy}
        onCancel={() => setOverwriteOpen(false)}
        onConfirm={() => {
          setOverwriteOpen(false);
          void runApply(true);
        }}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id="apply-plugin-skip-overwrite"
            checked={skipOverwritePrompt}
            onCheckedChange={(value) => setSkipOverwritePrompt(value === true)}
          />
          <Label htmlFor="apply-plugin-skip-overwrite" className="font-normal text-muted-foreground">
            Don&apos;t ask again this session
          </Label>
        </div>
      </ConfirmDialog>
    </>
  );
}
