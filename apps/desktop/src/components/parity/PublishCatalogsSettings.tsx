import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchCloudAuthStatus } from "../../lib/agent-client";
import {
  fetchRegisteredCatalogs,
  registerCatalog,
  unregisterCatalog,
  type PublishCatalogRef,
} from "../../lib/api/publish";
import type { CloudAuthStatus } from "../../lib/types";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";

export interface PublishCatalogsSettingsProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function catalogLabel(catalog: PublishCatalogRef): string {
  return `${catalog.org}/${catalog.catalog}`;
}

export function PublishCatalogsSettings({
  baseUrl,
  token,
  disabled = false,
}: PublishCatalogsSettingsProps) {
  const [catalogs, setCatalogs] = useState<PublishCatalogRef[]>([]);
  const [selector, setSelector] = useState("");
  const [account, setAccount] = useState("");
  const [cloudAuth, setCloudAuth] = useState<CloudAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUnregister, setPendingUnregister] = useState<PublishCatalogRef | null>(null);

  const loadCatalogs = useCallback(async () => {
    if (!baseUrl) {
      setCatalogs([]);
      return;
    }
    try {
      const registered = await fetchRegisteredCatalogs(baseUrl, token);
      setCatalogs(registered);
      setError(null);
    } catch (loadError) {
      setCatalogs([]);
      setError(errorMessage(loadError, "Could not load publish catalogs."));
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void loadCatalogs();
  }, [loadCatalogs]);

  useEffect(() => {
    if (!baseUrl) {
      setCloudAuth(null);
      return;
    }
    void fetchCloudAuthStatus(baseUrl, token)
      .then((status) => {
        setCloudAuth(status);
      })
      .catch(() => {
        setCloudAuth(null);
      });
  }, [baseUrl, token]);

  const catalogPlaceholder = cloudAuth?.orgSlug
    ? `${cloudAuth.orgSlug}/default`
    : "acme/internal";
  const accountPlaceholder = cloudAuth?.accountName || "default";
  const controlsDisabled = disabled || busy || !baseUrl;

  const onRegister = async () => {
    if (!baseUrl || busy) {
      return;
    }
    const trimmedSelector = selector.trim();
    if (!trimmedSelector) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmedAccount = account.trim();
      await registerCatalog(baseUrl, token, {
        selector: trimmedSelector,
        ...(trimmedAccount ? { account: trimmedAccount } : {}),
      });
      setSelector("");
      setAccount("");
      await loadCatalogs();
    } catch (registerError) {
      setError(errorMessage(registerError, "Could not register publish catalog."));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmUnregister = async () => {
    if (!baseUrl || !pendingUnregister || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unregisterCatalog(
        baseUrl,
        token,
        catalogLabel(pendingUnregister),
      );
      setPendingUnregister(null);
      await loadCatalogs();
    } catch (unregisterError) {
      setError(errorMessage(unregisterError, "Could not unregister publish catalog."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" data-testid="publish-catalog-settings">
      <h3>Publish catalogs</h3>
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {catalogs.length === 0 ? (
        <p className="muted">No publish catalogs registered yet.</p>
      ) : (
        <ul className="settings-list">
          {catalogs.map((catalog) => (
            <li key={catalogLabel(catalog)}>
              <span>
                {catalogLabel(catalog)}
                {catalog.account ? (
                  <span className="muted"> {catalog.account}</span>
                ) : null}
              </span>
              <button
                className="btn"
                type="button"
                disabled={controlsDisabled}
                onClick={() => setPendingUnregister(catalog)}
              >
                Unregister
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="form-field">
        <Label htmlFor="publish-catalog-selector">Catalog</Label>
        <Input
          id="publish-catalog-selector"
          value={selector}
          onChange={(event) => setSelector(event.target.value)}
          placeholder={catalogPlaceholder}
          disabled={controlsDisabled}
        />
      </div>
      <div className="form-field">
        <Label htmlFor="publish-catalog-account">Account</Label>
        <Input
          id="publish-catalog-account"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          placeholder={accountPlaceholder}
          disabled={controlsDisabled}
        />
      </div>
      <button
        className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
        type="button"
        disabled={controlsDisabled || !selector.trim()}
        onClick={() => void onRegister()}
        aria-busy={busy}
      >
        {busy ? <ButtonSpinner size={16} /> : null}
        {busy ? "Registering…" : "Register catalog"}
      </button>
      <ConfirmDialog
        open={pendingUnregister !== null}
        title="Unregister catalog?"
        description={
          pendingUnregister
            ? `Profiles that publish to all registered catalogs will no longer include ${catalogLabel(pendingUnregister)}. You can register it again later.`
            : ""
        }
        confirmLabel="Unregister"
        confirmBusy={busy}
        onConfirm={() => void onConfirmUnregister()}
        onCancel={() => {
          if (!busy) {
            setPendingUnregister(null);
          }
        }}
      />
    </section>
  );
}
