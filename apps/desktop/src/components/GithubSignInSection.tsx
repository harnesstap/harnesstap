import { useCallback, useEffect, useRef, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  cancelGithubLogin,
  fetchGithubAuthStatus,
  logoutGithubAuth,
  pollGithubLogin,
  startGithubLogin,
} from "../lib/agent-client";
import type { GithubAuthStatus, GithubPendingLogin } from "../lib/types";
import { Copy, ExternalLink, LogIn, LogOut, X } from "lucide-react";
import { ButtonSpinner } from "./ButtonSpinner";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

interface GithubSignInSectionProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

export function GithubSignInSection({
  open,
  baseUrl,
  token,
  disabled = false,
}: GithubSignInSectionProps) {
  const [status, setStatus] = useState<GithubAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const runPoll = useCallback(async () => {
    if (!baseUrl) {
      return;
    }
    try {
      const result = await pollGithubLogin(baseUrl, token);
      if (result.status === "pending") {
        pollTimer.current = window.setTimeout(() => {
          void runPoll();
        }, Math.max(1000, result.intervalMs ?? 5000));
        return;
      }
      if (result.status === "complete" && result.auth) {
        clearPoll();
        setBusy(false);
        setError(null);
        setStatus(result.auth);
        return;
      }
      clearPoll();
      setBusy(false);
      setError(result.message ?? "GitHub login failed.");
      setStatus(await fetchGithubAuthStatus(baseUrl, token));
    } catch (pollError) {
      clearPoll();
      setBusy(false);
      setError(errorMessage(pollError, "Could not finish GitHub login."));
    }
  }, [baseUrl, clearPoll, token]);

  useEffect(() => {
    if (!open) {
      clearPoll();
      return;
    }
    setError(null);
    setCopied(false);
    if (!baseUrl) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchGithubAuthStatus(baseUrl, token)
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
          if (next.pendingLogin) {
            setBusy(true);
            pollTimer.current = window.setTimeout(() => {
              void runPoll();
            }, 1000);
          }
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(errorMessage(loadError, "Could not load GitHub account."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [open, baseUrl, token, clearPoll, runPoll]);

  const onSignIn = async () => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const next = await startGithubLogin(baseUrl, token);
      setStatus(next);
      const pending = next.pendingLogin;
      if (pending?.verification_uri_complete) {
        try {
          await openUrl(pending.verification_uri_complete);
        } catch {
          // Browser open is best-effort; user can click Open browser.
        }
      }
      pollTimer.current = window.setTimeout(() => {
        void runPoll();
      }, 5000);
    } catch (loginError) {
      setBusy(false);
      setError(errorMessage(loginError, "Could not start GitHub login."));
    }
  };

  const onCancelLogin = async () => {
    if (!baseUrl) {
      return;
    }
    clearPoll();
    setBusy(true);
    setError(null);
    try {
      setStatus(await cancelGithubLogin(baseUrl, token));
    } catch (cancelError) {
      setError(errorMessage(cancelError, "Could not cancel GitHub login."));
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    if (!baseUrl || busy) {
      return;
    }
    clearPoll();
    setBusy(true);
    setError(null);
    try {
      setStatus(await logoutGithubAuth(baseUrl, token));
    } catch (logoutError) {
      setError(errorMessage(logoutError, "Could not sign out of GitHub."));
    } finally {
      setBusy(false);
    }
  };

  const onOpenBrowser = async (pending: GithubPendingLogin) => {
    try {
      await openUrl(pending.verification_uri_complete || pending.verification_uri);
    } catch (openError) {
      setError(errorMessage(openError, "Could not open the browser."));
    }
  };

  const onCopyCode = async (code: string) => {
    const ok = await copyText(code);
    setCopied(ok);
    if (!ok) {
      setError("Could not copy code to clipboard.");
    }
  };

  const controlsDisabled = disabled || busy || loading;
  const pending = status?.pendingLogin;
  const authenticated = status?.authenticated === true;

  return (
    <section className="account-auth-section" aria-label="GitHub">
      <div className="eyebrow">GitHub</div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {loading && !status ? (
        <p className="muted">Loading GitHub account...</p>
      ) : pending ? (
        <div className="cloud-login-pending">
          <h3>Approve GitHub sign-in in your browser</h3>
          <p className="muted">
            Enter this code on GitHub device login, or open the link which fills
            it in for you.
          </p>
          <div className="cloud-user-code" aria-label="Device code">
            {pending.user_code}
          </div>
          <div className="cloud-account-actions">
            <button
              className="btn primary"
              type="button"
              onClick={() => void onOpenBrowser(pending)}
              disabled={disabled}
            >
              <ExternalLink size={16} aria-hidden />
              Open browser
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void onCopyCode(pending.user_code)}
              disabled={disabled}
            >
              <Copy size={16} aria-hidden />
              {copied ? "Copied" : "Copy code"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void onCancelLogin()}
              disabled={disabled}
            >
              <X size={16} aria-hidden />
              Cancel
            </button>
          </div>
          <p className="muted cloud-login-waiting">
            <ButtonSpinner size={16} />
            Waiting for approval...
          </p>
        </div>
      ) : authenticated ? (
        <div className="cloud-account-summary">
          <div>
            <div className="eyebrow">Signed in</div>
            <h3>{status?.login || status?.name || "GitHub"}</h3>
            {status?.name && status?.login ? (
              <p className="muted">{status.name}</p>
            ) : null}
          </div>
          <div className="cloud-account-actions">
            <button
              className={["btn", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              onClick={() => void onSignOut()}
              disabled={controlsDisabled}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : <LogOut size={16} aria-hidden />}
              {busy ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      ) : (
        <div className="cloud-account-summary">
          <h3>Sign in with GitHub</h3>
          <p className="muted">
            Authorize the HarnessTap GitHub App to read private repositories
            used as plugin marketplaces.
          </p>
          <div className="cloud-account-actions">
            <button
              className={["btn", "primary", busy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={() => void onSignIn()}
              disabled={controlsDisabled || !baseUrl}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : <LogIn size={16} aria-hidden />}
              {busy ? "Starting..." : "Sign in with GitHub"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
