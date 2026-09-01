import { useCallback, useEffect, useId, useState } from "react";
import { Upload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AgentApiError } from "../../lib/api/http";
import {
  fetchCatalogBindings,
  planProfilePublish,
  publishProfile,
  putCatalogBindings,
  type ProfilePublishPlan,
  type PublishCatalogRef,
  type PublishPlanRow,
} from "../../lib/api/publish";
import {
  catalogKey,
  checkAllCheckboxState,
  parseCatalogKey,
  readRememberedCatalogKeys,
  resolveCheckedCatalogKeys,
  writeRememberedCatalogKeys,
} from "../../lib/publish-catalog-selection";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../../lib/dialog-dismiss";
import { ButtonSpinner } from "../ButtonSpinner";

export interface PublishProfileDrawerProps {
  profileName?: string | null;
  profileVersion?: string;
  baseUrl?: string | null;
  token?: string | null;
  disabled?: boolean;
  triggerClassName?: string;
  iconSize?: number;
  onSuccess?: (message: string) => void;
  onRequestSignIn?: () => void;
  onRequestCut?: (name: string, version: string) => void;
}

function publishToast(profileName: string, results: Array<{ org: string; catalog: string }>): string {
  const only = results[0];
  if (results.length === 1 && only) {
    return `Published ${profileName} to ${catalogKey(only.org, only.catalog)}`;
  }
  return `Published ${profileName} to ${results.length} catalogs`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function PublishProfileDrawer({
  profileName = null,
  profileVersion = "",
  baseUrl = null,
  token = null,
  disabled = false,
  triggerClassName = "icon-action",
  iconSize = 18,
  onSuccess,
  onRequestSignIn,
  onRequestCut,
}: PublishProfileDrawerProps) {
  const titleId = useId();
  const allId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [notAuthored, setNotAuthored] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ProfilePublishPlan | null>(null);
  const [registered, setRegistered] = useState<PublishCatalogRef[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);

  const close = useCallback(() => {
    if (busy) {
      return;
    }
    setOpen(false);
  }, [busy]);

  const closeRef = useDialogDismiss(open, close, busy);

  const rememberKeys = useCallback(
    (keys: string[]) => {
      if (!profileName) {
        return;
      }
      setCheckedKeys(keys);
      writeRememberedCatalogKeys(profileName, keys, storage());
    },
    [profileName],
  );

  const applyBindings = useCallback(
    async (bindingsRegistered: PublishCatalogRef[], mode: string, allowList: PublishCatalogRef[]) => {
      if (!profileName) {
        return;
      }
      setRegistered(bindingsRegistered);
      const remembered = readRememberedCatalogKeys(profileName, storage());
      const fromBindings =
        mode === "explicit"
          ? allowList.map((entry) => catalogKey(entry.org, entry.catalog))
          : null;
      rememberKeys(
        resolveCheckedCatalogKeys({
          registeredKeys: bindingsRegistered.map((entry) =>
            catalogKey(entry.org, entry.catalog),
          ),
          rememberedKeys: remembered ?? fromBindings,
        }),
      );
    },
    [profileName, rememberKeys],
  );

  const loadPlan = useCallback(async (options?: { loadBindings?: boolean }) => {
    if (!baseUrl || !profileName) {
      return;
    }
    setLoading(true);
    try {
      const next = await planProfilePublish(baseUrl, token, profileName);
      if (options?.loadBindings) {
        const bindings = await fetchCatalogBindings(baseUrl, token, profileName);
        applyBindings(bindings.registered, bindings.mode, bindings.allowList);
      }
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
        setRegistered([]);
        setCheckedKeys([]);
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
  }, [applyBindings, baseUrl, profileName, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadPlan({ loadBindings: true });
  }, [open, loadPlan]);

  useEffect(() => {
    if (!open || (!authRequired && !plan?.dirty)) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadPlan({ loadBindings: false });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [authRequired, loadPlan, open, plan?.dirty]);

  if (!profileName) {
    return (
      <button
        type="button"
        className={triggerClassName}
        data-testid="publish-profile-trigger"
        disabled
        aria-label="Publish"
        title="Publish"
      >
        <Upload size={iconSize} strokeWidth={2} aria-hidden />
      </button>
    );
  }

  const triggerDisabled = disabled || !baseUrl;
  const dirty = plan?.dirty === true;
  const registeredKeys = registered.map((entry) =>
    catalogKey(entry.org, entry.catalog),
  );
  const noCatalogRegistered = !loading && registered.length === 0;
  const hasCheckedCatalog = checkedKeys.length > 0;
  const publishEnabled =
    !authRequired
    && !dirty
    && !notAuthored
    && !noCatalogRegistered
    && hasCheckedCatalog
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
      const allowList = checkedKeys
        .map(parseCatalogKey)
        .filter((entry): entry is { org: string; catalog: string } => entry !== null);
      const allChecked =
        registeredKeys.length > 0 && checkedKeys.length === registeredKeys.length;
      await putCatalogBindings(
        baseUrl,
        token,
        profileName,
        allChecked
          ? { mode: "all_registered" }
          : { mode: "explicit", allowList },
      );
      const result = await publishProfile(baseUrl, token, profileName);
      const failed = result.results.filter((row) => !row.ok);
      if (failed.length > 0) {
        setError(
          failed
            .map((row) => `${catalogKey(row.org, row.catalog)}: ${row.error ?? "Publish failed"}`)
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

  const allState = checkAllCheckboxState(registered.length, checkedKeys.length);
  const checkedSet = new Set(checkedKeys);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        data-testid="publish-profile-trigger"
        onClick={() => setOpen(true)}
        disabled={triggerDisabled}
        aria-label="Publish"
        title="Publish"
      >
        <Upload size={iconSize} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          data-testid="publish-profile-drawer"
          onClick={(event) => {
            if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, busy)) {
              close();
            }
          }}
        >
          <div
            className="dialog publish-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <h2 id={titleId}>Publish {profileName}</h2>
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
                <section aria-label="Publish catalogs">
                  {noCatalogRegistered && !notAuthored && !error ? (
                    <p className="muted">no catalog registered</p>
                  ) : null}
                  {registered.length > 0 ? (
                    <ul className="publish-binding-list">
                      <li className="flex items-center gap-2">
                        <Checkbox
                          id={allId}
                          checked={allState}
                          disabled={disabled || busy}
                          onCheckedChange={(next) => {
                            rememberKeys(next === true ? registeredKeys : []);
                          }}
                        />
                        <Label htmlFor={allId} className="font-normal">
                          All catalogs
                        </Label>
                      </li>
                      {registered.map((catalog) => {
                        const key = catalogKey(catalog.org, catalog.catalog);
                        const id = `publish-catalog-${key}`;
                        return (
                          <li key={key} className="flex items-center gap-2">
                            <Checkbox
                              id={id}
                              checked={checkedSet.has(key)}
                              disabled={disabled || busy}
                              onCheckedChange={(next) => {
                                const nextKeys =
                                  next === true
                                    ? [...checkedKeys, key]
                                    : checkedKeys.filter((entry) => entry !== key);
                                rememberKeys(nextKeys);
                              }}
                            />
                            <Label htmlFor={id} className="font-normal">
                              {key}
                            </Label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {plan && plan.plans.length > 0 ? (
                    <ul className="publish-plan-list">
                      {plan.plans.map((row) => (
                        <PlanRow
                          key={catalogKey(row.target.org, row.target.catalog)}
                          row={row}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              </>
            )}
            <div className="dialog-actions">
              <button
                ref={closeRef}
                className="btn"
                type="button"
                onClick={close}
                disabled={busy}
              >
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
  const label = catalogKey(row.target.org, row.target.catalog);
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
