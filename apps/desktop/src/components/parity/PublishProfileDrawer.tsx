import { useCallback, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { AgentApiError } from "../../lib/api/http";
import {
  planProfilePublish,
  publishProfile,
  type ProfilePublishPlan,
  type PublishPlanRow,
} from "../../lib/api/publish";
import { ButtonSpinner } from "../ButtonSpinner";

export interface PublishProfileDrawerProps {
  profileName?: string | null;
  profileVersion?: string;
  baseUrl?: string | null;
  token?: string | null;
  disabled?: boolean;
  onSuccess?: (message: string) => void;
  onRequestSignIn?: () => void;
  onRequestCut?: (name: string, version: string) => void;
}

function catalogLabel(org: string, catalog: string): string {
  return `${org}/${catalog}`;
}

function publishToast(profileName: string, results: Array<{ org: string; catalog: string }>): string {
  const only = results[0];
  if (results.length === 1 && only) {
    return `Published ${profileName} to ${catalogLabel(only.org, only.catalog)}`;
  }
  return `Published ${profileName} to ${results.length} catalogs`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PublishProfileDrawer({
  profileName = null,
  profileVersion = "",
  baseUrl = null,
  token = null,
  disabled = false,
  onSuccess,
  onRequestSignIn,
  onRequestCut,
}: PublishProfileDrawerProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [notAuthored, setNotAuthored] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ProfilePublishPlan | null>(null);

  const close = useCallback(() => {
    if (busy) {
      return;
    }
    setOpen(false);
  }, [busy]);

  const loadPlan = useCallback(async () => {
    if (!baseUrl || !profileName) {
      return;
    }
    setLoading(true);
    try {
      const next = await planProfilePublish(baseUrl, token, profileName);
      setAuthRequired(false);
      setNotAuthored(null);
      setError(null);
      setPlan(next);
    } catch (loadError: unknown) {
      setPlan(null);
      if (loadError instanceof AgentApiError && loadError.code === "auth_required") {
        setAuthRequired(true);
        setNotAuthored(null);
        setError(null);
        return;
      }
      if (loadError instanceof AgentApiError && loadError.code === "not_authored") {
        setAuthRequired(false);
        setNotAuthored(loadError.message);
        setError(null);
        return;
      }
      if (loadError instanceof AgentApiError && loadError.code === "no_publish_catalogs") {
        setAuthRequired(false);
        setNotAuthored(null);
        setError(null);
        setPlan({
          profile: profileName,
          dirty: false,
          authored: true,
          warnings: [],
          plans: [],
        });
        return;
      }
      setAuthRequired(false);
      setNotAuthored(null);
      setError(errorMessage(loadError, "Could not plan profile publish."));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, profileName, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadPlan();
  }, [open, loadPlan]);

  useEffect(() => {
    if (!open || (!authRequired && !plan?.dirty)) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadPlan();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [authRequired, loadPlan, open, plan?.dirty]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, close, open]);

  if (!profileName) {
    return null;
  }

  const triggerDisabled = disabled || !baseUrl;
  const dirty = plan?.dirty === true;
  const okPlans = plan?.plans.filter((row) => row.ok) ?? [];
  const publishEnabled =
    !authRequired
    && !dirty
    && !notAuthored
    && okPlans.length > 0
    && !busy
    && !disabled
    && Boolean(baseUrl);

  const runPublish = async () => {
    if (!baseUrl || !publishEnabled) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await publishProfile(baseUrl, token, profileName);
      const failed = result.results.filter((row) => !row.ok);
      if (failed.length > 0) {
        setError(
          failed
            .map((row) => `${catalogLabel(row.org, row.catalog)}: ${row.error ?? "Publish failed"}`)
            .join("\n"),
        );
        return;
      }
      const succeeded = result.results.filter((row) => row.ok);
      onSuccess?.(publishToast(profileName, succeeded));
      setOpen(false);
    } catch (publishError: unknown) {
      setError(errorMessage(publishError, "Could not publish profile."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="icon-action"
        data-testid="publish-profile-trigger"
        onClick={() => setOpen(true)}
        disabled={triggerDisabled}
        aria-label="Publish"
        title="Publish"
      >
        <Upload size={18} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          className="dialog-backdrop create-profile-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              close();
            }
          }}
        >
          <div
            className="dialog create-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-profile-title"
            data-testid="publish-profile-drawer"
          >
            <div className="create-profile-header">
              <div>
                <div className="eyebrow">Cloud catalog</div>
                <h2 id="publish-profile-title">Publish {profileName}</h2>
              </div>
              <button
                className="icon-btn"
                type="button"
                aria-label="Close publish"
                onClick={close}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="create-profile-body">
              {authRequired ? (
                <div className="cloud-auth-state">
                  <h3>Cloud sign-in required</h3>
                  <p className="muted">
                    Sign in to HarnessTap Cloud to publish this profile.
                  </p>
                  <div className="cloud-account-actions">
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => onRequestSignIn?.()}
                      disabled={disabled || busy}
                    >
                      Sign in
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {notAuthored ? (
                    <>
                      <div className="banner error" role="alert">
                        {notAuthored}
                      </div>
                      <p className="muted">
                        Fork a catalog or upstream profile before publishing.
                      </p>
                    </>
                  ) : null}
                  {plan?.warnings.map((warning) => (
                    <div className="banner" role="status" key={warning.code}>
                      {warning.message}
                    </div>
                  ))}
                  {dirty ? (
                    <div className="banner error" role="alert">
                      This profile has unpublished edits. Cut a version before publishing.
                    </div>
                  ) : null}
                  {error ? (
                    <div className="banner error" role="alert">
                      {error}
                    </div>
                  ) : null}
                  {loading && !plan ? (
                    <p className="muted">Planning…</p>
                  ) : null}
                  {plan && plan.plans.length === 0 && !notAuthored && !error ? (
                    <p className="muted">
                      No publish catalogs registered. Add one in Settings.
                    </p>
                  ) : null}
                  {plan && plan.plans.length > 0 ? (
                    <ul className="publish-plan-list">
                      {plan.plans.map((row) => (
                        <PlanRow key={catalogLabel(row.target.org, row.target.catalog)} row={row} />
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>

            <div className="dialog-actions create-profile-actions">
              <button className="btn" type="button" onClick={close} disabled={busy}>
                Close
              </button>
              {dirty && !authRequired ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => onRequestCut?.(profileName, profileVersion)}
                  disabled={disabled || busy}
                >
                  Cut version
                </button>
              ) : null}
              {!authRequired ? (
                <button
                  className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
                  type="button"
                  onClick={() => void runPublish()}
                  disabled={!publishEnabled}
                  aria-busy={busy}
                >
                  {busy ? <ButtonSpinner size={16} /> : null}
                  {busy ? "Publishing…" : "Publish"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PlanRow({ row }: { row: PublishPlanRow }) {
  const label = catalogLabel(row.target.org, row.target.catalog);
  const account = row.account || row.target.account || "default";
  return (
    <li>
      <strong>{label}</strong>
      {account !== "default" ? <span className="muted"> {account}</span> : null}
      {row.ok && row.nextVersion ? <span> → {row.nextVersion}</span> : null}
      {!row.ok ? (
        <span className="muted"> {row.error ?? "Plan failed"}</span>
      ) : null}
    </li>
  );
}
