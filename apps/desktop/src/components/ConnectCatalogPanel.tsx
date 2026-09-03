import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerCatalog } from "../lib/api/publish";
import { connectCatalogOrgApi } from "../lib/api/sources";
import { connectCatalogDraftIsDirty } from "../lib/sources-panels";
import { Cloud, Plus, X } from "lucide-react";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";

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
  const [discardOpen, setDiscardOpen] = useState(false);

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
    setDiscardOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (busy) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy || !baseUrl;
  const canSubmit =
    mode === "register" ? Boolean(selector.trim()) : Boolean(org.trim());
  const dirty = connectCatalogDraftIsDirty({ selector, account, org });

  const requestClose = () => {
    if (busy) {
      return;
    }
    if (discardOpen) {
      return;
    }
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

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
          requestClose();
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
            onClick={requestClose}
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
          <fieldset className="resource-filter-section">
            <legend className="p-0 text-xs font-semibold">How to connect</legend>
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
            onClick={requestClose}
            disabled={controlsDisabled}
          >
            <X size={16} aria-hidden />
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
            {busy ? <ButtonSpinner size={16} /> : mode === "register" ? <Plus size={16} aria-hidden /> : <Cloud size={16} aria-hidden />}
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
      <ConfirmDialog
        open={discardOpen}
        title="Discard changes?"
        description="Typed fields will be lost."
        confirmLabel="Discard"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </div>
  );
}
