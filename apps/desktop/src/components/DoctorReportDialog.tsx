import { useEffect, useId, useRef } from "react";
import type { PluginDoctorReport } from "../lib/api/library-plugins";
import {
  doctorStatusPills,
  summarizeDoctorReport,
} from "../lib/doctor-report";
import { ButtonSpinner } from "./ButtonSpinner";

export interface DoctorReportDialogProps {
  open: boolean;
  pluginName: string;
  busy: boolean;
  error: string | null;
  report: PluginDoctorReport | null;
  onClose: () => void;
}

export function DoctorReportDialog({
  open,
  pluginName,
  busy,
  error,
  report,
  onClose,
}: DoctorReportDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const summary = report ? summarizeDoctorReport(report) : null;
  const showStatus = Boolean(report) && !busy && !error;
  const pills = showStatus && summary ? doctorStatusPills(summary) : [];

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
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
          {pills.map((pill) => (
            <span key={pill.label} className={`pill ${pill.tone}`}>
              {pill.label}
            </span>
          ))}
        </div>
        {busy ? <ButtonSpinner /> : null}
        {error ? <p className="muted">{error}</p> : null}
        {report && summary && summary.groups.length > 0
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
        {report && summary && summary.groups.length === 0 && !busy && !error ? (
          <p className="muted">No issues found.</p>
        ) : null}
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
