import { useEffect, useState } from "react";
import { appLogDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { RefreshCw } from "lucide-react";
import { CONNECT_SPLASH_COPY } from "../../lib/ui-copy";
import type { AgentPhase } from "../../state/agent-session";
import { ButtonSpinner } from "../ButtonSpinner";
import { Banner } from "./Banner";

export const RECONNECT_RETRY_MS = 5000;

export interface ConnectSplashProps {
  phase: AgentPhase;
  error: string | null;
  /** Sidecar stderr and exit status, shown in an expandable block. */
  errorDetail?: string | null;
  retryBusy: boolean;
  onRetry: () => void;
}

async function resolveLogPath(): Promise<string | null> {
  try {
    const dir = await appLogDir();
    return dir.trim() ? dir : null;
  } catch {
    return null;
  }
}

/** First-connect splash. The shell stays unmounted until the first successful connect. */
export function ConnectSplash({
  phase,
  error,
  errorDetail,
  retryBusy,
  onRetry,
}: ConnectSplashProps) {
  const [logPath, setLogPath] = useState<string | null>(null);
  const [openLogsError, setOpenLogsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveLogPath().then((path) => {
      if (!cancelled) {
        setLogPath(path);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onOpenLogs = async () => {
    if (!logPath) {
      return;
    }
    setOpenLogsError(null);
    try {
      await openPath(logPath);
    } catch (openError) {
      const reason =
        openError instanceof Error ? openError.message : String(openError ?? "");
      setOpenLogsError(CONNECT_SPLASH_COPY.openLogsFailed(reason));
    }
  };

  switch (phase) {
    case "connecting":
      return (
        <div className="connect-splash m-fade-in" data-testid="connect-splash">
          <h1>HarnessTap</h1>
          <div className="connect-splash-bar" aria-hidden="true">
            <div className="connect-splash-bar-fill m-skeleton" />
          </div>
          <p className="muted">{CONNECT_SPLASH_COPY.starting}</p>
        </div>
      );
    case "disconnected":
      return (
        <div className="connect-splash m-fade-in" data-testid="connect-splash">
          <h1>HarnessTap</h1>
          <p className="connect-splash-error" role="alert">
            {error ?? CONNECT_SPLASH_COPY.couldNotConnect}
          </p>
          {errorDetail ? (
            <details className="connect-splash-detail" data-testid="connect-splash-detail">
              <summary>{CONNECT_SPLASH_COPY.detailsSummary}</summary>
              <pre>{errorDetail}</pre>
            </details>
          ) : null}
          <div className="connect-splash-actions">
            <button
              type="button"
              className={["btn", "primary", retryBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
              onClick={onRetry}
              disabled={retryBusy}
              aria-busy={retryBusy}
            >
              {retryBusy ? <ButtonSpinner size={16} /> : <RefreshCw size={16} aria-hidden />}
              {retryBusy ? CONNECT_SPLASH_COPY.restarting : CONNECT_SPLASH_COPY.restartAgent}
            </button>
            {logPath ? (
              <button
                type="button"
                className="btn"
                data-testid="connect-splash-open-logs"
                onClick={() => void onOpenLogs()}
              >
                {CONNECT_SPLASH_COPY.openLogs}
              </button>
            ) : null}
          </div>
          {openLogsError ? (
            <p className="connect-splash-error" role="alert" data-testid="connect-splash-open-logs-error">
              {openLogsError}
            </p>
          ) : null}
        </div>
      );
    case "connected":
      return null;
    default: {
      const neverPhase: never = phase;
      return neverPhase;
    }
  }
}

export interface ReconnectBannerProps {
  retryBusy: boolean;
  onRetry: () => void;
}

/**
 * Later disconnects: keep the shell and announce the reconnect. The session
 * restarts the agent by itself; after 5s the banner also offers Restart agent.
 */
export function ReconnectBanner({ retryBusy, onRetry }: ReconnectBannerProps) {
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowRetry(true), RECONNECT_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Banner
      tone="neutral"
      className="connection-banner"
      message={
        <span className="banner-message-with-icon">
          <ButtonSpinner size={16} />
          {CONNECT_SPLASH_COPY.reconnecting}
        </span>
      }
      onRetry={showRetry ? onRetry : undefined}
      retryBusy={retryBusy}
      retryLabel={CONNECT_SPLASH_COPY.restartAgent}
      retryShowLabel
      retryBusyLabel={CONNECT_SPLASH_COPY.restarting}
      role="status"
      testId="reconnect-banner"
    />
  );
}
