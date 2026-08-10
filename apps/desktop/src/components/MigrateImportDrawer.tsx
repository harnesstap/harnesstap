import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  detectMigrateImportScope,
  migrateImport,
} from "../lib/agent-client";
import type {
  MigrateImportResult,
  MigrateScope,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";

export interface MigrateImportDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onImported?: (result: MigrateImportResult) => void;
  onBusyChange?: (busy: boolean) => void;
}

type ImportStep = "path" | "scope" | "confirm";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function scopeLabel(scope: MigrateScope): string {
  switch (scope) {
    case "workspace":
      return "Full workspace";
    case "plugin":
      return "Plugin";
    case "resource":
      return "Resource";
    case "environment":
      return "Environment";
    default: {
      const neverScope: never = scope;
      return neverScope;
    }
  }
}

function stepTitle(step: ImportStep): string {
  switch (step) {
    case "path":
      return "Choose import file";
    case "scope":
      return "Import scope";
    case "confirm":
      return "Confirm import";
    default: {
      const neverStep: never = step;
      return neverStep;
    }
  }
}

function previousStep(step: ImportStep): ImportStep | null {
  switch (step) {
    case "path":
      return null;
    case "scope":
      return "path";
    case "confirm":
      return "scope";
    default: {
      const neverStep: never = step;
      return neverStep;
    }
  }
}

export function MigrateImportDrawer({
  open,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onImported,
  onBusyChange,
}: MigrateImportDrawerProps) {
  const [step, setStep] = useState<ImportStep>("path");
  const [importPath, setImportPath] = useState<string | null>(null);
  const [scope, setScope] = useState<MigrateScope>("workspace");
  const [detectedScope, setDetectedScope] = useState<MigrateScope | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setStep("path");
    setImportPath(null);
    setScope("workspace");
    setDetectedScope(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !detecting && !disabled) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, detecting, disabled, onClose, open]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case "path":
        return importPath !== null && importPath.trim().length > 0;
      case "scope":
        return true;
      case "confirm":
        return false;
      default: {
        const neverStep: never = step;
        return neverStep;
      }
    }
  }, [importPath, step]);

  const pickImportPath = async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [
        { name: "HarnessTap migrate", extensions: ["gz", "tar", "json", "toml"] },
      ],
    });
    if (typeof selected === "string") {
      setImportPath(selected);
      setDetectedScope(null);
      setError(null);
    }
  };

  const handleNext = async () => {
    if (step === "path") {
      if (!baseUrl || !importPath || detecting) {
        return;
      }
      setDetecting(true);
      setError(null);
      try {
        const result = await detectMigrateImportScope(baseUrl, token, importPath);
        setDetectedScope(result.scope);
        setScope(result.scope);
        setStep("scope");
      } catch (detectError) {
        setError(errorMessage(detectError, "Could not detect import scope."));
      } finally {
        setDetecting(false);
      }
      return;
    }
    if (step === "scope") {
      setStep("confirm");
      setError(null);
    }
  };

  const runImport = async () => {
    if (!baseUrl || !importPath || busy) {
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const result = await migrateImport(baseUrl, token, {
        path: importPath,
        scope,
      });
      onImported?.(result);
      onClose();
    } catch (importError) {
      setError(errorMessage(importError, "Could not import."));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy || detecting;
  const showBack = previousStep(step) !== null;

  return (
    <div
      className="dialog-backdrop create-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !controlsDisabled) {
          onClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog migrate-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="migrate-import-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Migrate</div>
            <h2 id="migrate-import-title">Import</h2>
            <p className="muted">{stepTitle(step)}</p>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close import drawer"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body migrate-import-body">
          {step === "path" ? (
            <div className="form-field gap-2">
              <Label>Import file</Label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn"
                  type="button"
                  onClick={() => void pickImportPath()}
                  disabled={controlsDisabled}
                >
                  Choose file…
                </button>
                <span className="mono text-xs">
                  {importPath ?? "No file selected"}
                </span>
              </div>
            </div>
          ) : null}

          {step === "scope" ? (
            <>
              {detectedScope ? (
                <p className="muted m-0 text-[11px]">
                  Detected as: <strong>{scopeLabel(detectedScope)}</strong>
                </p>
              ) : null}
              <RadioGroup
                value={scope}
                onValueChange={(value) => {
                  setScope(value as MigrateScope);
                  setError(null);
                }}
                disabled={controlsDisabled}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="workspace"
                    id="migrate-import-scope-workspace"
                  />
                  <Label
                    htmlFor="migrate-import-scope-workspace"
                    className="font-normal"
                  >
                    Full workspace (archive)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="plugin" id="migrate-import-scope-plugin" />
                  <Label htmlFor="migrate-import-scope-plugin" className="font-normal">
                    Plugin bundle
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="resource"
                    id="migrate-import-scope-resource"
                  />
                  <Label
                    htmlFor="migrate-import-scope-resource"
                    className="font-normal"
                  >
                    Single resource
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="environment"
                    id="migrate-import-scope-environment"
                  />
                  <Label
                    htmlFor="migrate-import-scope-environment"
                    className="font-normal"
                  >
                    Environment
                  </Label>
                </div>
              </RadioGroup>
            </>
          ) : null}

          {step === "confirm" ? (
            <>
              <dl className="migrate-import-summary m-0 grid gap-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">File</dt>
                  <dd className="m-0 text-right mono">{importPath}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Scope</dt>
                  <dd className="m-0 text-right">{scopeLabel(scope)}</dd>
                </div>
              </dl>
              <p className="muted m-0 text-[11px]">
                Importing may update existing matching plugins, resources,
                environments, or workspace data.
              </p>
            </>
          ) : null}

          {error ? <div className="banner error">{error}</div> : null}
        </div>

        <div className="dialog-actions create-profile-actions">
          {showBack ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                const prev = previousStep(step);
                if (prev) {
                  setStep(prev);
                  setError(null);
                }
              }}
              disabled={controlsDisabled}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            Cancel
          </button>
          {step === "confirm" ? (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={() => void runImport()}
              disabled={controlsDisabled || !importPath}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Importing…" : "Import"}
            </button>
          ) : (
            <button
              className={["btn", "primary", detecting ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={() => void handleNext()}
              disabled={controlsDisabled || !canGoNext}
              aria-busy={detecting}
            >
              {detecting ? <ButtonSpinner size={16} /> : null}
              {detecting ? "Detecting…" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
