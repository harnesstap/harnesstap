import { useCallback, useEffect, useRef, useState } from "react";
import { postMigrateResolveOrder, type OrderMigrationReport } from "../../lib/api/resolve-order";
import { Check, RefreshCw } from "lucide-react";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";

export interface ResolveOrderSettingsProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onSaved?: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function overrideCountLabel(count: number): string {
  return `${count} override${count === 1 ? "" : "s"}`;
}

function projectCountLabel(count: number): string {
  return `${count} project${count === 1 ? "" : "s"}`;
}

function previewSummary(report: OrderMigrationReport): string {
  if (report.overridesWritten.length > 0) {
    return `${overrideCountLabel(report.overridesWritten.length)} would pin last-applied winners across ${projectCountLabel(report.projectsWithSnapshot)} with snapshots.`;
  }
  if (report.projectsWithSnapshot > 0) {
    return "Last applied winners already match current resolution. No overrides to write.";
  }
  return "No apply snapshots to compare. This only pins winners from a recorded project apply.";
}

export function ResolveOrderSettings({
  baseUrl,
  token,
  disabled = false,
  onSaved,
}: ResolveOrderSettingsProps) {
  const [previewing, setPreviewing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [report, setReport] = useState<OrderMigrationReport | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const generationRef = useRef(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearSuccessTimer();
    };
  }, [clearSuccessTimer]);

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

  const controlsDisabled = disabled || !baseUrl || previewing || writing;
  const pendingOverrideCount = report?.overridesWritten.length ?? 0;
  const canWrite = previewed && pendingOverrideCount > 0 && !controlsDisabled;

  const runPreview = useCallback(async () => {
    if (!baseUrl || disabled) return;
    const generation = ++generationRef.current;
    setPreviewing(true);
    setError(null);
    setSuccess(null);
    clearSuccessTimer();
    try {
      const next = await postMigrateResolveOrder(baseUrl, token, true);
      if (generation !== generationRef.current) return;
      setReport(next);
      setPreviewed(true);
    } catch (previewError) {
      if (generation !== generationRef.current) return;
      setPreviewed(false);
      setReport(null);
      setError(
        errorMessage(
          previewError,
          "Could not compare last applied winners to current resolution.",
        ),
      );
    } finally {
      if (generation === generationRef.current) {
        setPreviewing(false);
      }
    }
  }, [baseUrl, token, disabled, clearSuccessTimer]);

  useEffect(() => {
    if (!baseUrl || disabled) return;
    void runPreview();
  }, [baseUrl, disabled, runPreview]);

  const runWrite = async () => {
    if (!baseUrl || writing) return;
    const generation = ++generationRef.current;
    setWriting(true);
    setError(null);
    setSuccess(null);
    clearSuccessTimer();
    try {
      const next = await postMigrateResolveOrder(baseUrl, token, false);
      if (generation !== generationRef.current) return;
      setReport(next);
      setPreviewed(true);
      setConfirmOpen(false);
      flashSuccess(
        `Wrote ${overrideCountLabel(next.overridesWritten.length)} across ${projectCountLabel(next.projectsWithSnapshot)}`,
      );
      onSaved?.();
    } catch (writeError) {
      if (generation !== generationRef.current) return;
      setConfirmOpen(false);
      setError(
        errorMessage(
          writeError,
          "Could not write resource overrides.",
        ),
      );
    } finally {
      if (generation === generationRef.current) {
        setWriting(false);
      }
    }
  };

  return (
    <section
      className="settings-section"
      data-testid="resolve-order-settings"
    >
      <h3>Advanced</h3>
      <h4>Preserve last applied winners</h4>
      <p className="field-note muted">
        When two plugins provide the same resource, apply prefers the plugin
        closer to the one you applied. Older applies used last-in-stack instead.
        This compares recorded project apply snapshots to current resolution
        and can write resource overrides so those older winners stay. It only
        updates plugin override records — harness files are unchanged until
        you apply again.
      </p>
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="success-flash" role="status">
          {success}
        </div>
      ) : null}
      {report?.warnings.map((warning) => (
        <div key={warning} className="banner" role="status">
          {warning}
        </div>
      ))}
      {previewed && report ? (
        <p className="muted" data-testid="resolve-order-summary">
          {previewSummary(report)}
        </p>
      ) : null}
      {previewed && report && report.overridesWritten.length > 0 ? (
        <ul>
          {report.overridesWritten.map((row) => (
            <li key={`${row.root}:${row.key}:${row.winner}`}>
              {row.root} · {row.key} → {row.winner}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="dialog-actions">
        <button
          className={["btn", previewing ? "is-busy" : ""].filter(Boolean).join(" ")}
          type="button"
          data-testid="resolve-order-preview"
          onClick={() => void runPreview()}
          disabled={controlsDisabled}
          aria-busy={previewing}
        >
          {previewing ? <ButtonSpinner size={16} /> : <RefreshCw size={16} aria-hidden />}
          {previewing ? "Checking…" : "Check again"}
        </button>
        {previewed && pendingOverrideCount > 0 ? (
          <button
            className={["btn", "primary", writing ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            data-testid="resolve-order-write"
            onClick={() => setConfirmOpen(true)}
            disabled={!canWrite}
            aria-busy={writing}
          >
            {writing ? <ButtonSpinner size={16} /> : <Check size={16} aria-hidden />}
            {writing ? "Writing…" : "Write overrides"}
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Write resource overrides?"
        description="This pins last-applied winners on plugin roots where current resolution would pick a different plugin. Harness files are not rewritten until you apply again."
        confirmLabel="Write overrides"
        cancelLabel="Cancel"
        confirmBusy={writing}
        onCancel={() => {
          if (!writing) setConfirmOpen(false);
        }}
        onConfirm={() => {
          void runWrite();
        }}
      />
    </section>
  );
}
