import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerCatalog } from "../lib/api/publish";
import { connectCatalogOrgApi } from "../lib/api/sources";
import { ButtonSpinner } from "./ButtonSpinner";

type ConnectCatalogMode = "register" | "org";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface ConnectCatalogPanelProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function ConnectCatalogPanel({
  open,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onSaved,
}: ConnectCatalogPanelProps) {
  const [mode, setMode] = useState<ConnectCatalogMode>("register");
  const [selector, setSelector] = useState("");
  const [account, setAccount] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode("register");
    setSelector("");
    setAccount("");
    setOrg("");
    setBusy(false);
    setError(null);
  }, [open]);

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy || !baseUrl;
  const canSubmit =
    mode === "register" ? Boolean(selector.trim()) : Boolean(org.trim());

  const onSubmit = async () => {
    if (!baseUrl || !canSubmit || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      switch (mode) {
        case "register": {
          const trimmedAccount = account.trim();
          await registerCatalog(baseUrl, token, {
            selector: selector.trim(),
            ...(trimmedAccount ? { account: trimmedAccount } : {}),
          });
          onSaved("Publish catalog registered.");
          onClose();
          return;
        }
        case "org": {
          await connectCatalogOrgApi(baseUrl, token, org.trim());
          onSaved(`Connected org ${org.trim()}.`);
          onClose();
          return;
        }
        default: {
          const neverMode: never = mode;
          return neverMode;
        }
      }
    } catch (saveError: unknown) {
      setError(
        errorMessage(
          saveError,
          mode === "register"
            ? "Could not register publish catalog."
            : "Could not connect catalog org.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop create-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !controlsDisabled) {
          onClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-catalog-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Sources</div>
            <h2 id="connect-catalog-title">Connect catalog</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close connect catalog drawer"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body">
          {error ? (
            <div className="banner error" role="alert">
              {error}
            </div>
          ) : null}
          <fieldset className="form-field gap-1.5">
            <legend>How to connect</legend>
            <label
              className={`resource-filter-option${mode === "register" ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="connect-catalog-mode"
                checked={mode === "register"}
                disabled={controlsDisabled}
                onChange={() => setMode("register")}
              />
              <span>Register publish catalog</span>
            </label>
            <label
              className={`resource-filter-option${mode === "org" ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="connect-catalog-mode"
                checked={mode === "org"}
                disabled={controlsDisabled}
                onChange={() => setMode("org")}
              />
              <span>Connect org</span>
            </label>
          </fieldset>
          {mode === "register" ? (
            <>
              <div className="form-field gap-1.5">
                <Label htmlFor="connect-catalog-selector">Catalog</Label>
                <Input
                  id="connect-catalog-selector"
                  value={selector}
                  onChange={(event) => setSelector(event.target.value)}
                  placeholder="acme/internal"
                  disabled={controlsDisabled}
                />
              </div>
              <div className="form-field gap-1.5">
                <Label htmlFor="connect-catalog-account">
                  Account <span className="muted">(optional)</span>
                </Label>
                <Input
                  id="connect-catalog-account"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  placeholder="default"
                  disabled={controlsDisabled}
                />
              </div>
            </>
          ) : (
            <div className="form-field gap-1.5">
              <Label htmlFor="connect-catalog-org">Org</Label>
              <Input
                id="connect-catalog-org"
                value={org}
                onChange={(event) => setOrg(event.target.value)}
                placeholder="acme"
                disabled={controlsDisabled}
              />
            </div>
          )}
        </div>

        <div className="dialog-actions create-profile-actions">
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            Cancel
          </button>
          <button
            className={["btn", "primary", busy ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSubmit || controlsDisabled}
            aria-busy={busy}
          >
            {busy ? <ButtonSpinner size={16} /> : null}
            {busy
              ? mode === "register"
                ? "Registering…"
                : "Connecting…"
              : mode === "register"
                ? "Register catalog"
                : "Connect org"}
          </button>
        </div>
      </div>
    </div>
  );
}
