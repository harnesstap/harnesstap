import { useEffect, useState } from "react";
import { appLogDir } from "@tauri-apps/api/path";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { RefreshCw } from "lucide-react";
import type { AgentPhase } from "../../state/agent-session";
import { ButtonSpinner } from "../ButtonSpinner";
import { Banner } from "./Banner";

export const RECONNECT_RETRY_MS = 5000;

export interface ConnectSplashProps {
  phase: AgentPhase;
  error: string | null;
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
  retryBusy,
  onRetry,
}: ConnectSplashProps) {
  const [logPath, setLogPath] = useState<string | null>(null);

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

  const onOpenLogs = () => {
    if (!logPath) {
      return;
    }
    void openPath(logPath);
  };

  switch (phase) {
    case "connecting":
      return (
        <div className="connect-splash m-fade-in" data-testid="connect-splash">
          <h1>HarnessTap</h1>
          <div className="connect-splash-bar" aria-hidden="true">
            <div className="connect-splash-bar-fill m-skeleton" />
          </div>
          <p className="muted">Starting the agent…</p>
        </div>
      );
    case "disconnected":
      return (
        <div className="connect-splash m-fade-in" data-testid="connect-splash">
          <h1>HarnessTap</h1>
          <p className="connect-splash-error" role="alert">
            {error ?? "Could not connect to the agent."}
          </p>
          <div className="connect-splash-actions">
            <button
              type="button"
              className={["btn", "primary", retryBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
              onClick={onRetry}
              disabled={retryBusy}
              aria-busy={retryBusy}
            >
              {retryBusy ? <ButtonSpinner size={16} /> : <RefreshCw size={16} aria-hidden />}
              Retry
            </button>
            {logPath ? (
              <button type="button" className="btn" onClick={onOpenLogs}>
                Open logs
              </button>
            ) : null}
          </div>
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

/** Later disconnects: keep the shell, announce reconnect, offer Retry after 5s. */
export function ReconnectBanner({ retryBusy, onRetry }: ReconnectBannerProps) {
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowRetry(true), RECONNECT_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Banner
      tone="info"
      className="connection-banner"
      message="Reconnecting…"
      onRetry={showRetry ? onRetry : undefined}
      retryBusy={retryBusy}
      role="status"
      testId="reconnect-banner"
    />
  );
}
