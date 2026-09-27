import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../../lib/dialog-dismiss";
import {
  groupHarnessPluginPullReport,
  HARNESS_PLUGIN_PULL_TITLE,
  harnessPluginPullProgressCopy,
  pullLatestHarnessPlugins,
  versionChangeLine,
  type HarnessPluginPullReport,
  type HarnessPluginPullRow,
  type HarnessPluginPullTarget,
} from "../../lib/harness-plugin-pull";
import { ButtonSpinner } from "../ButtonSpinner";
import { Presence } from "../motion/Presence";
import { motionClass } from "../motion/motion-utils";

export interface PluginPullReportDialogProps {
  open: boolean;
  targets: readonly HarnessPluginPullTarget[];
  runKey: number;
  baseUrl: string | null;
  token: string | null;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onFinished?: (report: HarnessPluginPullReport) => void;
}

function PullRowList({
  title,
  rows,
  showMessage,
}: {
  title: string;
  rows: readonly HarnessPluginPullRow[];
  showMessage?: boolean;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="plugin-pull-report-group">
      <h3>{title}</h3>
      <ul>
        {rows.map((row) => {
          const version = versionChangeLine(row.fromVersion, row.toVersion);
          return (
            <li key={row.selector}>
              <span className="plugin-pull-report-name">{row.name}</span>
              {version ? (
                <>
                  {" "}
                  <span className="muted plugin-pull-report-version">{version}</span>
                </>
              ) : null}
              {showMessage && row.message ? (
                <span className="plugin-pull-report-message">{row.message}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PluginPullReportDialog({
  open,
  targets,
  runKey,
  baseUrl,
  token,
  onClose,
  onBusyChange,
  onFinished,
}: PluginPullReportDialogProps) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [report, setReport] = useState<HarnessPluginPullReport | null>(null);
  const closeRef = useDialogDismiss(open, onClose, busy);
  const groups = report ? groupHarnessPluginPullReport(report) : null;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    if (!open || !baseUrl) {
      setReport(null);
      setBusy(false);
      setProgress({ completed: 0, total: 0 });
      onBusyChangeRef.current?.(false);
      return;
    }

    const runningTargets = targetsRef.current;
    let cancelled = false;
    setBusy(true);
    setReport(null);
    setProgress({ completed: 0, total: runningTargets.length });
    onBusyChangeRef.current?.(true);
    void pullLatestHarnessPlugins(
      baseUrl,
      token,
      runningTargets,
      (completed, total) => {
        if (!cancelled) {
          setProgress({ completed, total });
        }
      },
    )
      .then((next) => {
        onFinishedRef.current?.(next);
        if (cancelled) {
          return;
        }
        setReport(next);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setBusy(false);
        onBusyChangeRef.current?.(false);
      });

    return () => {
      cancelled = true;
      onBusyChangeRef.current?.(false);
    };
  }, [open, baseUrl, token, runKey]);

  return (
    <Presence
      open={open}
      enter="m-scrim-in"
      exit="m-scrim-out"
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, busy)) {
          onClose();
        }
      }}
    >
      {(state) => (
        <div
          className={motionClass("dialog plugin-pull-report-dialog", "m-rise", state)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="plugin-pull-report-dialog"
        >
          <div className="plugin-pull-report-header">
            <h2 id={titleId}>{HARNESS_PLUGIN_PULL_TITLE}</h2>
            {report?.pills.map((pill) => (
              <span key={pill.label} className={`pill ${pill.tone}`}>
                {pill.label}
              </span>
            ))}
          </div>
          <div className="plugin-pull-report-body" aria-busy={busy}>
            {busy ? (
              <p className="muted" role="status">
                <ButtonSpinner />{" "}
                {harnessPluginPullProgressCopy(progress.completed, progress.total)}
              </p>
            ) : null}
            {groups && groups.updated.length === 0 && groups.current.length === 0 && groups.failed.length === 0 && !busy ? (
              <p className="muted">No plugins to pull.</p>
            ) : null}
            {groups ? (
              <>
                <PullRowList title="Updated" rows={groups.updated} />
                <PullRowList title="Already current" rows={groups.current} />
                <PullRowList title="Could not pull" rows={groups.failed} showMessage />
              </>
            ) : null}
          </div>
          <div className="dialog-actions">
            <button
              ref={closeRef}
              className="btn"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              <X size={16} aria-hidden />
              Close
            </button>
          </div>
        </div>
      )}
    </Presence>
  );
}
