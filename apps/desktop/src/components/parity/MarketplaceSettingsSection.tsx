import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMarketplace, fetchMarketplaces } from "../../lib/agent-client";
import { removeMarketplace } from "../../lib/api/marketplace-remove";
import type { PluginMarketplaceEntry } from "../../lib/types";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function MarketplaceSettingsSection({
  open,
  baseUrl,
  token,
  disabled = false,
}: {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}) {
  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceEntry[]>([]);
  const [marketplaceUrl, setMarketplaceUrl] = useState("");
  const [marketplaceName, setMarketplaceName] = useState("");
  const [marketplaceBusy, setMarketplaceBusy] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceWarning, setMarketplaceWarning] = useState<string | null>(null);
  const [marketplaceSuccess, setMarketplaceSuccess] = useState<string | null>(null);
  const [marketplacePendingRemove, setMarketplacePendingRemove] =
    useState<PluginMarketplaceEntry | null>(null);
  const marketplaceSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearMarketplaceSuccessTimer = useCallback(() => {
    if (marketplaceSuccessTimerRef.current !== null) {
      clearTimeout(marketplaceSuccessTimerRef.current);
      marketplaceSuccessTimerRef.current = null;
    }
  }, []);

  const flashMarketplaceSuccess = useCallback(
    (message: string) => {
      clearMarketplaceSuccessTimer();
      setMarketplaceSuccess(message);
      marketplaceSuccessTimerRef.current = setTimeout(() => {
        setMarketplaceSuccess(null);
        marketplaceSuccessTimerRef.current = null;
      }, 3000);
    },
    [clearMarketplaceSuccessTimer],
  );

  const loadMarketplaces = useCallback(async () => {
    if (!baseUrl || !token) {
      setMarketplaces([]);
      return;
    }
    try {
      const result = await fetchMarketplaces(baseUrl, token);
      setMarketplaces(result.marketplaces);
      setMarketplaceError(null);
    } catch (loadError) {
      setMarketplaces([]);
      setMarketplaceError(
        errorMessage(loadError, "Could not load marketplaces."),
      );
    }
  }, [baseUrl, token]);

  useEffect(() => {
    if (!open || !baseUrl || !token) {
      if (!open) {
        setMarketplaceUrl("");
        setMarketplaceName("");
        setMarketplaceBusy(false);
        setMarketplaceError(null);
        setMarketplaceWarning(null);
        setMarketplaceSuccess(null);
        setMarketplacePendingRemove(null);
        clearMarketplaceSuccessTimer();
      }
      return;
    }
    void loadMarketplaces();
  }, [open, baseUrl, token, loadMarketplaces, clearMarketplaceSuccessTimer]);

  useEffect(
    () => () => {
      clearMarketplaceSuccessTimer();
    },
    [clearMarketplaceSuccessTimer],
  );

  const marketplaceControlsDisabled = !token || marketplaceBusy || disabled;

  const onAddMarketplace = async () => {
    if (!baseUrl || !token || marketplaceBusy) {
      return;
    }
    const url = marketplaceUrl.trim();
    const name = marketplaceName.trim();
    if (!url || !name) {
      return;
    }
    setMarketplaceBusy(true);
    setMarketplaceError(null);
    setMarketplaceWarning(null);
    setMarketplaceSuccess(null);
    clearMarketplaceSuccessTimer();
    try {
      const result = await addMarketplace(baseUrl, token, { url, name });
      await loadMarketplaces();
      setMarketplaceUrl("");
      setMarketplaceName("");
      if (!result.refresh.ok) {
        setMarketplaceWarning(result.refresh.message);
      } else {
        flashMarketplaceSuccess(
          result.status === "already_configured"
            ? "Marketplace already configured."
            : "Marketplace added.",
        );
      }
    } catch (addError) {
      setMarketplaceSuccess(null);
      clearMarketplaceSuccessTimer();
      setMarketplaceError(
        errorMessage(addError, "Could not add marketplace."),
      );
    } finally {
      setMarketplaceBusy(false);
    }
  };

  const onConfirmRemoveMarketplace = async () => {
    if (!baseUrl || !token || marketplaceBusy || !marketplacePendingRemove) {
      return;
    }
    const pending = marketplacePendingRemove;
    setMarketplaceBusy(true);
    setMarketplaceError(null);
    setMarketplaceWarning(null);
    setMarketplaceSuccess(null);
    clearMarketplaceSuccessTimer();
    try {
      await removeMarketplace(baseUrl, token, pending.name);
      setMarketplacePendingRemove(null);
      await loadMarketplaces();
      flashMarketplaceSuccess("Marketplace removed.");
    } catch (removeError) {
      setMarketplacePendingRemove(null);
      setMarketplaceSuccess(null);
      clearMarketplaceSuccessTimer();
      setMarketplaceError(
        errorMessage(removeError, "Could not remove marketplace."),
      );
    } finally {
      setMarketplaceBusy(false);
    }
  };

  return (
    <section
      className="settings-section"
      data-testid="marketplace-settings"
    >
      <h3>Plugin marketplaces</h3>
      {marketplaceError ? (
        <div className="banner error" role="alert">
          {marketplaceError}
        </div>
      ) : null}
      {marketplaceWarning ? (
        <div className="banner" role="status">
          {marketplaceWarning}
        </div>
      ) : null}
      {marketplaceSuccess ? (
        <div className="success-flash" role="status">
          {marketplaceSuccess}
        </div>
      ) : null}
      <ul className="marketplace-list" data-testid="marketplace-list">
        {marketplaces.length === 0 ? (
          <li className="muted">No marketplaces registered yet.</li>
        ) : (
          marketplaces.map((entry) => (
            <li
              key={entry.name}
              data-testid={`marketplace-row-${entry.name}`}
            >
              <div className="flex flex-row items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="marketplace-row-name">{entry.name}</span>
                  <span className="marketplace-row-url muted">{entry.url}</span>
                  {entry.platforms.length > 0 ? (
                    <span className="marketplace-row-platforms muted">
                      {entry.platforms.join(", ")}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="icon-action"
                  aria-label={`Remove marketplace ${entry.name}`}
                  title="Remove marketplace"
                  data-testid={`marketplace-remove-${entry.name}`}
                  disabled={marketplaceControlsDisabled}
                  onClick={() => setMarketplacePendingRemove(entry)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
      <div className="form-field">
        <Label htmlFor="marketplace-url">Marketplace URL</Label>
        <Input
          id="marketplace-url"
          data-testid="marketplace-url"
          type="url"
          value={marketplaceUrl}
          onChange={(event) => setMarketplaceUrl(event.target.value)}
          placeholder="https://github.com/org/marketplace"
          disabled={marketplaceControlsDisabled}
        />
      </div>
      <div className="form-field">
        <Label htmlFor="marketplace-name">Marketplace name</Label>
        <Input
          id="marketplace-name"
          data-testid="marketplace-name"
          value={marketplaceName}
          onChange={(event) => setMarketplaceName(event.target.value)}
          placeholder="my-marketplace"
          disabled={marketplaceControlsDisabled}
        />
      </div>
      <button
        className={[
          "btn",
          "primary",
          marketplaceBusy ? "is-busy" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        type="button"
        data-testid="marketplace-add"
        onClick={() => void onAddMarketplace()}
        disabled={
          marketplaceControlsDisabled
          || !marketplaceUrl.trim()
          || !marketplaceName.trim()
        }
        aria-busy={marketplaceBusy}
      >
        {marketplaceBusy ? <ButtonSpinner size={16} /> : null}
        {marketplaceBusy ? "Adding…" : "Add marketplace"}
      </button>
      <ConfirmDialog
        open={marketplacePendingRemove !== null}
        title="Remove marketplace?"
        description={
          marketplacePendingRemove ? (
            <p className="muted">
              Removing <strong>{marketplacePendingRemove.name}</strong> unregisters
              this source. Plugins already pinned on profiles stay installed.
            </p>
          ) : (
            ""
          )
        }
        confirmLabel="Remove marketplace"
        cancelLabel="Cancel"
        confirmBusy={marketplaceBusy}
        onConfirm={() => void onConfirmRemoveMarketplace()}
        onCancel={() => {
          if (!marketplaceBusy) {
            setMarketplacePendingRemove(null);
          }
        }}
      />
    </section>
  );
}
