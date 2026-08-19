import { useEffect, useId, useState } from "react";
import { AgentApiError } from "../lib/agent-client";
import {
  runLibraryPluginDoctor,
  type PluginDoctorReport,
} from "../lib/api/library-plugins";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../lib/dialog-dismiss";
import { summarizeDoctorReport } from "../lib/doctor-report";
import { ButtonSpinner } from "./ButtonSpinner";

export interface DoctorReportDialogProps {
  open: boolean;
  pluginName: string;
  selector: string;
  baseUrl: string | null;
  token: string | null;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onSuccess: (message: string) => void;
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof AgentApiError || error instanceof Error) {
    return error.message;
  }
  return "Could not run plugin doctor";
}

export function DoctorReportDialog({
  open,
  pluginName,
  selector,
  baseUrl,
  token,
  onClose,
  onBusyChange,
  onSuccess,
}: DoctorReportDialogProps) {
  const titleId = useId();
  const closeRef = useDialogDismiss(open, onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PluginDoctorReport | null>(null);
  const summary = report && !busy && !error ? summarizeDoctorReport(report) : null;

  useEffect(() => {
    if (!open || !baseUrl || !selector) {
      setReport(null);
      setError(null);
      setBusy(false);
      onBusyChange?.(false);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);
    setReport(null);
    onBusyChange?.(true);
    void runLibraryPluginDoctor(baseUrl, token, selector)
      .then((next) => {
        if (cancelled) {
          return;
        }
        setReport(next);
        onSuccess(
          next.valid
            ? `Doctor: ${next.plugin} valid`
            : `Doctor: ${next.plugin} invalid`,
        );
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadErrorMessage(loadError));
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setBusy(false);
        onBusyChange?.(false);
      });

    return () => {
      cancelled = true;
      onBusyChange?.(false);
    };
  }, [open, baseUrl, token, selector]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget)) {
          onClose();
        }
      }}
    >
      <div
        className="dialog doctor-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="doctor-report-header">
          <h2 id={titleId}>{pluginName}</h2>
          {summary?.pills.map((pill) => (
            <span key={pill.label} className={`pill ${pill.tone}`}>
              {pill.label}
            </span>
          ))}
        </div>
        <div aria-busy={busy}>
          {busy ? (
            <p className="muted" role="status">
              <ButtonSpinner /> Running…
            </p>
          ) : null}
          {error ? (
            <div className="banner error" role="alert">
              {error}
            </div>
          ) : null}
          {summary && summary.groups.length > 0
            ? summary.groups.map((group) => (
                <div key={group.check} className="doctor-report-group">
                  <h3>{group.check}</h3>
                  <ul>
                    {group.messages.map((message, index) => (
                      <li key={`${group.check}-${index}`}>{message}</li>
                    ))}
                  </ul>
                </div>
              ))
            : null}
          {summary && summary.groups.length === 0 ? (
            <p className="muted">No issues found.</p>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button
            ref={closeRef}
            className="btn"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
