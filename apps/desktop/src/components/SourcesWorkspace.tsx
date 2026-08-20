import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMarketplaces } from "../lib/agent-client";
import { unregisterCatalog } from "../lib/api/publish";
import { removeMarketplace } from "../lib/api/marketplace-remove";
import {
  disconnectCatalogOrgApi,
  fetchCatalogScope,
  type CatalogScope,
} from "../lib/api/sources";
import { type SourcesPane } from "../lib/sources-pane";
import {
  buildSourceRows,
  defaultCheckedSourceIds,
} from "../lib/sources-sidebar";
import type { PluginMarketplaceEntry } from "../lib/types";
import { ConnectCatalogPanel } from "./ConnectCatalogPanel";
import { MarketplaceEditPanel } from "./MarketplaceEditPanel";
import { SourceSidebar } from "./SourceSidebar";

const FALLBACK_DEFAULT_ORG = "harnesstap-cloud";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface SourcesWorkspaceProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  homeResetNonce?: number;
  onSuccess?: (message: string) => void;
}

export function SourcesWorkspace({
  baseUrl,
  token,
  disabled = false,
  homeResetNonce = 0,
  onSuccess,
}: SourcesWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<SourcesPane>({ mode: "list" });
  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceEntry[]>([]);
  const [scope, setScope] = useState<CatalogScope | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>(["local"]);
  const [checksTouched, setChecksTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [marketplaceMode, setMarketplaceMode] = useState<"add" | "edit">("add");
  const [editingMarketplace, setEditingMarketplace] =
    useState<PluginMarketplaceEntry | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const homeResetNonceSeen = useRef(homeResetNonce);

  const rows = useMemo(
    () =>
      buildSourceRows({
        marketplaces,
        defaultOrg: scope?.defaultOrg ?? FALLBACK_DEFAULT_ORG,
        connectedOrgs: scope?.connectedOrgs ?? [],
        registered: scope?.registered ?? [],
      }),
    [marketplaces, scope],
  );

  useEffect(() => {
    if (!checksTouched) {
      setCheckedIds(defaultCheckedSourceIds(rows));
    }
  }, [rows, checksTouched]);

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    setQuery("");
    setChecksTouched(false);
    setCheckedIds(defaultCheckedSourceIds(rows));
    setPane({ mode: "list" });
  }, [homeResetNonce, rows]);

  const refresh = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setMarketplaces([]);
      setScope(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchMarketplaces(baseUrl, token),
      fetchCatalogScope(baseUrl, token),
    ])
      .then(([marketplaceResult, nextScope]) => {
        if (cancelled) {
          return;
        }
        setMarketplaces(marketplaceResult.marketplaces);
        setScope(nextScope);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(errorMessage(loadError, "Could not load sources."));
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, reloadKey]);

  const onToggle = (id: string) => {
    setChecksTouched(true);
    setCheckedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const onRemoveMarketplace = async (name: string) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeMarketplace(baseUrl, token, name);
      onSuccess?.(`Removed marketplace ${name}.`);
      refresh();
    } catch (removeError: unknown) {
      setError(errorMessage(removeError, "Could not remove marketplace."));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnectOrg = async (org: string) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await disconnectCatalogOrgApi(baseUrl, token, org);
      onSuccess?.(`Disconnected org ${org}.`);
      refresh();
    } catch (disconnectError: unknown) {
      setError(errorMessage(disconnectError, "Could not disconnect org."));
    } finally {
      setBusy(false);
    }
  };

  const onUnregisterCatalog = async (selector: string) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unregisterCatalog(baseUrl, token, selector);
      onSuccess?.(`Unregistered ${selector}.`);
      refresh();
    } catch (unregisterError: unknown) {
      setError(errorMessage(unregisterError, "Could not unregister catalog."));
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = disabled || !baseUrl;
  const emptyCopy = query.trim()
    ? "No hits yet."
    : "Search sources";

  return (
    <main
      className="resources-panel sources-workspace"
      aria-label="Sources"
      data-testid="sources-workspace"
      data-sources-pane={pane.mode}
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title">
            <span>Sources</span>
            <span className="muted resources-panel-scope">
              Search local, marketplaces, and HarnessTap Cloud.
            </span>
          </div>
          <div className="resources-panel-header-actions">
            <button
              type="button"
              className="btn primary"
              aria-label="Add marketplace"
              title="Add marketplace"
              disabled={controlsDisabled}
              onClick={() => {
                setMarketplaceMode("add");
                setEditingMarketplace(null);
                setMarketplaceOpen(true);
              }}
            >
              Add marketplace
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Connect catalog"
              title="Connect catalog"
              disabled={controlsDisabled}
              onClick={() => setCatalogOpen(true)}
            >
              Connect catalog
            </button>
          </div>
        </div>
      </div>

      <div className="resources-panel-layout">
        <SourceSidebar
          query={query}
          onQueryChange={setQuery}
          rows={rows}
          checkedIds={checkedIds}
          onToggle={onToggle}
          disabled={controlsDisabled}
          busy={busy}
          error={error}
          onEditMarketplace={(name) => {
            const entry = marketplaces.find((item) => item.name === name) ?? null;
            if (!entry) {
              return;
            }
            setMarketplaceMode("edit");
            setEditingMarketplace(entry);
            setMarketplaceOpen(true);
          }}
          onRemoveMarketplace={(name) => void onRemoveMarketplace(name)}
          onDisconnectOrg={(org) => void onDisconnectOrg(org)}
          onUnregisterCatalog={(selector) => void onUnregisterCatalog(selector)}
        />
        <div className="resources-panel-body">
          <div className="empty-state">
            <p className="muted">{emptyCopy}</p>
          </div>
        </div>
      </div>

      <MarketplaceEditPanel
        open={marketplaceOpen}
        mode={marketplaceMode}
        entry={editingMarketplace}
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        onClose={() => {
          setMarketplaceOpen(false);
          setEditingMarketplace(null);
        }}
        onSaved={(message) => {
          onSuccess?.(message);
          refresh();
        }}
        onListed={refresh}
      />
      <ConnectCatalogPanel
        open={catalogOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        onClose={() => setCatalogOpen(false)}
        onSaved={(message) => {
          onSuccess?.(message);
          refresh();
        }}
      />
    </main>
  );
}
