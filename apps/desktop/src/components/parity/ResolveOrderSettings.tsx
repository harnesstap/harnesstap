import { useCallback, useEffect, useRef, useState } from "react";
import { postMigrateResolveOrder, type OrderMigrationReport } from "../../lib/api/resolve-order";
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
  const canWrite =
    previewed && (report?.overridesWritten.length ?? 0) > 0 && !controlsDisabled;

  const runPreview = async () => {
    if (!baseUrl || controlsDisabled) return;
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
          "Could not convert apply-order to overrides.",
        ),
      );
    } finally {
      if (generation === generationRef.current) {
        setPreviewing(false);
      }
    }
  };

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
        `Migrated ordering to overrides · ${overrideCountLabel(next.overridesWritten.length)} across ${projectCountLabel(next.projectsWithSnapshot)}`,
      );
      onSaved?.();
    } catch (writeError) {
      if (generation !== generationRef.current) return;
      setConfirmOpen(false);
      setError(
        errorMessage(
          writeError,
          "Could not convert apply-order to overrides.",
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
      <h4>Convert apply-order to overrides</h4>
      <p className="field-note muted">
        After nearest-wins resolution, previously applied plugin results can
        shift. This writes explicit resource overrides so those results stay
        the same. Preview first. This does not export or import files, and it
        does not re-apply profiles.
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
      {previewed && report && report.overridesWritten.length === 0 ? (
        <p className="muted">
          No overrides needed. Previously applied winners already match current
          resolution.
        </p>
      ) : null}
      {previewed && report && report.overridesWritten.length > 0 ? (
        <>
          <p>
            {overrideCountLabel(report.overridesWritten.length)} across{" "}
            {projectCountLabel(report.projectsWithSnapshot)} with snapshots
          </p>
          <ul>
            {report.overridesWritten.map((row) => (
              <li key={`${row.root}:${row.key}:${row.winner}`}>
                {row.root} · {row.key} → {row.winner}
              </li>
            ))}
          </ul>
        </>
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
          {previewing ? <ButtonSpinner size={16} /> : null}
          {previewing ? "Previewing…" : "Preview"}
        </button>
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
          {writing ? <ButtonSpinner size={16} /> : null}
          {writing ? "Writing…" : "Write overrides"}
        </button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Write resource overrides?"
        description="This writes explicit resource overrides on plugin roots so previously applied results keep winning. It does not re-apply profiles or change live harness files."
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
