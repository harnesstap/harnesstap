import { useCallback, useEffect, useRef, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  cancelCloudLogin,
  fetchCloudAuthStatus,
  logoutCloudAuth,
  pollCloudLogin,
  startCloudLogin,
} from "../lib/agent-client";
import { AgentApiError } from "../lib/api/http";
import {
  fetchCloudOrgs,
  filterCloudOrgs,
  switchCloudOrg,
  type CloudOrg,
} from "../lib/api/cloud-orgs";
import type { CloudAuthStatus, CloudPendingLogin } from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";

interface CloudAccountDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onAuthChange?: (status: CloudAuthStatus) => void;
  onOrgSwitched?: (slug: string) => void;
}

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

function OrganizationsList({
  orgs,
  orgQuery,
  onOrgQueryChange,
  orgsLoading,
  switchingSlug,
  disabled,
  busy,
  onSwitchOrg,
}: {
  orgs: CloudOrg[];
  orgQuery: string;
  onOrgQueryChange: (value: string) => void;
  orgsLoading: boolean;
  switchingSlug: string | null;
  disabled: boolean;
  busy: boolean;
  onSwitchOrg: (org: CloudOrg) => void;
}) {
  const controlsLocked = disabled || busy || orgsLoading || switchingSlug !== null;
  const visible = filterCloudOrgs(orgs, orgQuery);

  return (
    <section aria-label="Organizations">
      <h3>Organizations</h3>
      {orgs.length >= 6 ? (
        <label className="form-field">
          <span className="muted">Filter</span>
          <input
            type="search"
            value={orgQuery}
            onChange={(event) => onOrgQueryChange(event.target.value)}
            disabled={controlsLocked}
            placeholder="Filter organizations"
          />
        </label>
      ) : null}
      {orgsLoading && orgs.length === 0 ? (
        <p className="muted">Loading organizations…</p>
      ) : orgs.length === 0 ? (
        <p className="muted">No organizations.</p>
      ) : visible.length === 0 ? (
        <p className="muted">No matching organizations.</p>
      ) : (
        <ul className="marketplace-list">
          {visible.map((org) => {
            const rowBusy = switchingSlug === org.slug;
            return (
              <li key={org.id || org.slug}>
                <span className="marketplace-row-name">{org.name}</span>
                <span className="mono">{org.slug}</span>
                {org.current ? (
                  <span className="muted">Current</span>
                ) : (
                  <button
                    className={["btn", rowBusy ? "is-busy" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={() => onSwitchOrg(org)}
                    disabled={controlsLocked}
                    aria-busy={rowBusy}
                  >
                    {rowBusy ? <ButtonSpinner size={16} /> : null}
                    {rowBusy ? "Switching…" : "Switch"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CloudAccountDrawer({
  open,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onAuthChange,
  onOrgSwitched,
}: CloudAccountDrawerProps) {
  const [status, setStatus] = useState<CloudAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [orgs, setOrgs] = useState<CloudOrg[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgQuery, setOrgQuery] = useState("");
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const onAuthChangeRef = useRef(onAuthChange);
  onAuthChangeRef.current = onAuthChange;

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const applyStatus = useCallback((next: CloudAuthStatus) => {
    setStatus(next);
    onAuthChangeRef.current?.(next);
  }, []);

  const runPoll = useCallback(async () => {
    if (!baseUrl) {
      return;
    }
    try {
      const result = await pollCloudLogin(baseUrl, token);
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
        applyStatus(result.auth);
        return;
      }
      clearPoll();
      setBusy(false);
      setError(result.message ?? "Cloud login failed.");
      applyStatus(await fetchCloudAuthStatus(baseUrl, token));
    } catch (pollError) {
      clearPoll();
      setBusy(false);
      setError(errorMessage(pollError, "Could not finish cloud login."));
    }
  }, [applyStatus, baseUrl, clearPoll, token]);

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
    void fetchCloudAuthStatus(baseUrl, token)
      .then((next) => {
        if (!cancelled) {
          applyStatus(next);
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
          setError(errorMessage(loadError, "Could not load cloud account."));
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
  }, [open, baseUrl, token, applyStatus, clearPoll, runPoll]);

  useEffect(() => {
    if (!open || !baseUrl || status?.authenticated !== true || status.pendingLogin) {
      if (!open) {
        setOrgs([]);
        setOrgQuery("");
      }
      return;
    }
    let cancelled = false;
    setOrgsLoading(true);
    void fetchCloudOrgs(baseUrl, token)
      .then((result) => {
        if (!cancelled) {
          setOrgs(result.orgs);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError("Could not load organizations.");
          void loadError;
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOrgsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token, status?.authenticated, status?.pendingLogin, status?.orgSlug]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !switchingSlug && !disabled) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, switchingSlug, disabled, onClose]);

  const onSwitchOrg = async (org: CloudOrg) => {
    if (!baseUrl || busy || disabled || orgsLoading || switchingSlug) {
      return;
    }
    setSwitchingSlug(org.slug);
    setError(null);
    try {
      const next = await switchCloudOrg(baseUrl, token, org.slug);
      applyStatus(next);
      onOrgSwitched?.(org.slug);
    } catch (switchError) {
      const notFound =
        switchError instanceof AgentApiError && switchError.code === "org_not_found";
      setError(
        notFound ? "Organization not found." : "Could not switch organization.",
      );
    } finally {
      setSwitchingSlug(null);
    }
  };

  const onSignIn = async () => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const next = await startCloudLogin(baseUrl, token);
      applyStatus(next);
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
      setError(errorMessage(loginError, "Could not start cloud login."));
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
      applyStatus(await cancelCloudLogin(baseUrl, token));
    } catch (cancelError) {
      setError(errorMessage(cancelError, "Could not cancel cloud login."));
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
      applyStatus(await logoutCloudAuth(baseUrl, token));
    } catch (logoutError) {
      setError(errorMessage(logoutError, "Could not sign out."));
    } finally {
      setBusy(false);
    }
  };

  const onOpenBrowser = async (pending: CloudPendingLogin) => {
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

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy || loading;
  const pending = status?.pendingLogin;
  const authenticated = status?.authenticated === true;

  return (
    <div
      className="dialog-backdrop create-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog cloud-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-account-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">HarnessTap Cloud</div>
            <h2 id="cloud-account-title">Account</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close account panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body cloud-account-body">
          {error && (
            <div className="banner error" role="alert">
              {error}
            </div>
          )}

          {loading && !status ? (
            <p className="muted">Loading account…</p>
          ) : pending ? (
            <div className="cloud-login-pending">
              <h3>Approve sign-in in your browser</h3>
              <p className="muted">
                Enter this code on the HarnessTap Cloud device page, or open the
                link which fills it in for you.
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
                  Open browser
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void onCopyCode(pending.user_code)}
                  disabled={disabled}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void onCancelLogin()}
                  disabled={disabled}
                >
                  Cancel
                </button>
              </div>
              <p className="muted cloud-login-waiting">Waiting for approval…</p>
            </div>
          ) : authenticated ? (
            <div className="cloud-account-summary">
              <div>
                <div className="eyebrow">Signed in</div>
                <h3>{status?.name || status?.email || "Cloud account"}</h3>
                {status?.email && status?.name ? (
                  <p className="muted">{status.email}</p>
                ) : null}
              </div>
              <dl className="cloud-account-meta">
                {status?.orgSlug ? (
                  <>
                    <dt>Organization</dt>
                    <dd className="mono">{status.orgSlug}</dd>
                  </>
                ) : null}
                {status?.cloudBaseUrl ? (
                  <>
                    <dt>Cloud</dt>
                    <dd className="mono">{status.cloudBaseUrl}</dd>
                  </>
                ) : null}
                {status?.accountName ? (
                  <>
                    <dt>Account</dt>
                    <dd className="mono">{status.accountName}</dd>
                  </>
                ) : null}
              </dl>
              <OrganizationsList
                orgs={orgs}
                orgQuery={orgQuery}
                onOrgQueryChange={setOrgQuery}
                orgsLoading={orgsLoading}
                switchingSlug={switchingSlug}
                disabled={disabled}
                busy={busy}
                onSwitchOrg={(org) => void onSwitchOrg(org)}
              />
              <div className="cloud-account-actions">
                <button
                  className={["btn", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
                  type="button"
                  onClick={() => void onSignOut()}
                  disabled={controlsDisabled}
                  aria-busy={busy}
                >
                  {busy ? <ButtonSpinner size={16} /> : null}
                  {busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          ) : (
            <div className="cloud-account-summary">
              <h3>Sign in to Cloud</h3>
              <p className="muted">
                Connect your HarnessTap Cloud account to browse and pull shared
                profiles from this desktop app.
              </p>
              <div className="cloud-account-actions">
                <button
                  className={[
                    "btn",
                    "primary",
                    busy ? "is-busy" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() => void onSignIn()}
                  disabled={controlsDisabled || !baseUrl}
                  aria-busy={busy}
                >
                  {busy ? <ButtonSpinner size={16} /> : null}
                  {busy ? "Starting…" : "Sign in to Cloud"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
