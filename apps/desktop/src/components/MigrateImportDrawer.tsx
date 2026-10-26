import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  detectMigrateImportScope,
  migrateImport,
} from "../lib/agent-client";
import {
  MIGRATE_IMPORT_SCOPE_HEADING,
  migrateImportScopeOptions,
  migrateImportSteps,
  migrateStepCopy,
  migrateStepPosition,
  type MigrateImportStep,
} from "../lib/migrate-defaults";
import type {
  MigrateImportResult,
  MigrateScope,
} from "../lib/types";
import { ArrowLeft, ChevronRight, FolderDown, X } from "lucide-react";
import { ButtonSpinner } from "./ButtonSpinner";
import { FullScreenPanel } from "./FullScreenPanel";
import { MigrateFilePicker } from "./MigrateFilePicker";
import { MigrateScopeRadios } from "./MigrateScopeRadios";
import { Presence } from "./motion/Presence";
import { DisabledReason } from "./DisabledReason";

export interface MigrateImportDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onImported?: (result: MigrateImportResult) => void;
  onBusyChange?: (busy: boolean) => void;
}

type ImportStep = MigrateImportStep;

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
    default: {
      const neverScope: never = scope;
      return neverScope;
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
        {
          name: "HarnessTap migrate",
          extensions: ["gz", "tar", "ap.json", "json"],
        },
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

  const controlsDisabled = disabled || busy || detecting;
  const importSteps = migrateImportSteps();
  const stepMeta = migrateStepPosition(importSteps, step);
  const showBack = previousStep(step) !== null;

  return (
    <Presence open={open} exit="m-panel-out">
    <FullScreenPanel
      titleId="migrate-import-title"
      title="Import"
      eyebrow="Migrate"
      subtitle={migrateStepCopy(stepMeta.current, stepMeta.total)}
      closeLabel="Close import"
      closeDisabled={controlsDisabled}
      onClose={onClose}
      bodyClassName="migrate-import-body"
      actions={
        <>
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
              <ArrowLeft size={16} aria-hidden />
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
            <X size={16} aria-hidden />
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
              {busy ? <ButtonSpinner size={16} /> : <FolderDown size={16} aria-hidden />}
              {busy ? "Importing..." : "Import"}
            </button>
          ) : (
            <DisabledReason reason={!canGoNext && !controlsDisabled && step === "path" ? "Choose a file to import" : null}>
              <button
                className={["btn", "primary", detecting ? "is-busy" : ""]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={() => void handleNext()}
                disabled={controlsDisabled || !canGoNext}
                aria-busy={detecting}
              >
                {detecting ? <ButtonSpinner size={16} /> : <ChevronRight size={16} aria-hidden />}
                {detecting ? "Detecting..." : "Next"}
              </button>
            </DisabledReason>
          )}
        </>
      }
    >
          {step === "path" ? (
            <MigrateFilePicker
              label="Import file"
              icon={<FolderDown size={16} aria-hidden />}
              path={importPath}
              onChoose={() => void pickImportPath()}
              disabled={controlsDisabled}
            />
          ) : null}

          {step === "scope" ? (
            <>
              {detectedScope ? (
                <p className="muted m-0 text-[11px]">
                  Detected as: <strong>{scopeLabel(detectedScope)}</strong>
                </p>
              ) : null}
              <MigrateScopeRadios
                idPrefix="migrate-import-scope"
                heading={MIGRATE_IMPORT_SCOPE_HEADING}
                options={migrateImportScopeOptions}
                value={scope}
                onValueChange={(nextScope) => {
                  setScope(nextScope);
                  setError(null);
                }}
                disabled={controlsDisabled}
              />
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
                Importing may update existing matching plugins, resources, or
                workspace data.
              </p>
            </>
          ) : null}

          {error ? <div className="banner error">{error}</div> : null}
    </FullScreenPanel>
    </Presence>
  );
}
