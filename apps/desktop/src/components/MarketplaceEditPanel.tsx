import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMarketplace } from "../lib/agent-client";
import { patchMarketplace } from "../lib/api/sources";
import {
  marketplaceDraftIsDirty,
  marketplaceSubmitCloseAction,
} from "../lib/sources-panels";
import type {
  PluginMarketplaceEntry,
  PluginMarketplacePlatform,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";

const MARKETPLACE_PLATFORMS: PluginMarketplacePlatform[] = [
  "claude-code",
  "cursor",
  "goose",
  "copilot-cli",
];

const DEFAULT_PLATFORMS: PluginMarketplacePlatform[] = ["claude-code"];

export function deriveMarketplaceNameFromUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (last) {
      return last.replace(/\.git$/i, "");
    }
  } catch {
    // fall through to path split fallback
  }
  const last = trimmed.split("/").filter(Boolean).at(-1);
  return last ? last.replace(/\.git$/i, "") : "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function togglePlatform(
  platforms: PluginMarketplacePlatform[],
  platform: PluginMarketplacePlatform,
): PluginMarketplacePlatform[] {
  return platforms.includes(platform)
    ? platforms.filter((item) => item !== platform)
    : [...platforms, platform];
}

export interface MarketplaceEditPanelProps {
  open: boolean;
  mode: "add" | "edit";
  entry?: PluginMarketplaceEntry | null;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onListed?: () => void;
}

export function MarketplaceEditPanel({
  open,
  mode,
  entry,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onSaved,
  onListed,
}: MarketplaceEditPanelProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [platforms, setPlatforms] = useState<PluginMarketplacePlatform[]>([
    ...DEFAULT_PLATFORMS,
  ]);
  const [baselineUrl, setBaselineUrl] = useState("");
  const [baselineName, setBaselineName] = useState("");
  const [baselinePlatforms, setBaselinePlatforms] = useState<
    PluginMarketplacePlatform[]
  >([...DEFAULT_PLATFORMS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && entry) {
      const nextPlatforms =
        entry.platforms.length > 0 ? [...entry.platforms] : [...DEFAULT_PLATFORMS];
      setUrl(entry.url);
      setName(entry.name);
      setNameTouched(true);
      setPlatforms(nextPlatforms);
      setBaselineUrl(entry.url);
      setBaselineName(entry.name);
      setBaselinePlatforms(nextPlatforms);
    } else {
      setUrl("");
      setName("");
      setNameTouched(false);
      setPlatforms([...DEFAULT_PLATFORMS]);
      setBaselineUrl("");
      setBaselineName("");
      setBaselinePlatforms([...DEFAULT_PLATFORMS]);
    }
    setBusy(false);
    setError(null);
    setWarning(null);
    setDiscardOpen(false);
  }, [open, mode, entry]);

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
  const resolvedName = name.trim() || deriveMarketplaceNameFromUrl(url);
  const canSubmit =
    Boolean(url.trim()) && Boolean(resolvedName) && platforms.length > 0;
  const dirty = marketplaceDraftIsDirty({
    url,
    name,
    platforms,
    baselineUrl,
    baselineName,
    baselinePlatforms,
  });

  const onUrlChange = (nextUrl: string) => {
    setUrl(nextUrl);
    if (mode === "add" && !nameTouched) {
      setName(deriveMarketplaceNameFromUrl(nextUrl));
    }
  };

  const markClean = (nextUrl: string, nextName: string) => {
    setBaselineUrl(nextUrl);
    setBaselineName(nextName);
    setBaselinePlatforms([...platforms]);
  };

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

  const applyRefreshOutcome = (
    refresh: { ok: boolean; message: string } | undefined,
    successMessage: string,
    nextUrl: string,
    nextName: string,
  ): boolean => {
    if (marketplaceSubmitCloseAction(refresh) === "stay-warning" && refresh) {
      setWarning(refresh.message);
      markClean(nextUrl, nextName);
      onListed?.();
      return true;
    }
    onSaved(successMessage);
    onClose();
    return false;
  };

  const onSubmit = async () => {
    if (!baseUrl || !canSubmit || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    const nextUrl = url.trim();
    const nextName = resolvedName;
    try {
      if (mode === "add") {
        const result = await addMarketplace(baseUrl, token, {
          url: nextUrl,
          name: nextName,
          platforms,
        });
        applyRefreshOutcome(
          result.refresh,
          result.status === "already_configured"
            ? "Marketplace already configured."
            : "Marketplace added.",
          nextUrl,
          nextName,
        );
        return;
      }
      if (!entry) {
        return;
      }
      const result = await patchMarketplace(baseUrl, token, entry.name, {
        name: nextName,
        url: nextUrl,
        platforms,
      });
      applyRefreshOutcome(
        result.refresh,
        "Marketplace updated.",
        nextUrl,
        nextName,
      );
    } catch (saveError: unknown) {
      setError(
        errorMessage(
          saveError,
          mode === "add"
            ? "Could not add marketplace."
            : "Could not update marketplace.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "add" ? "Add marketplace" : "Edit marketplace";
  const submitLabel = mode === "add" ? "Add marketplace" : "Save marketplace";

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
        aria-labelledby="marketplace-edit-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Sources</div>
            <h2 id="marketplace-edit-title">{title}</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close marketplace drawer"
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
          {warning ? (
            <div className="banner" role="status">
              {warning}
            </div>
          ) : null}
          <div className="form-field gap-1.5">
            <Label htmlFor="marketplace-edit-url">URL</Label>
            <Input
              id="marketplace-edit-url"
              type="url"
              autoFocus={mode === "add"}
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="https://github.com/org/marketplace"
              disabled={controlsDisabled}
            />
          </div>
          <div className="form-field gap-1.5">
            <Label htmlFor="marketplace-edit-name">Name</Label>
            <Input
              id="marketplace-edit-name"
              value={name}
              onChange={(event) => {
                setNameTouched(true);
                setName(event.target.value);
              }}
              placeholder="my-marketplace"
              disabled={controlsDisabled}
            />
          </div>
          <fieldset className="form-field gap-1.5">
            <legend>Platforms</legend>
            {MARKETPLACE_PLATFORMS.map((platform) => (
              <div className="flex items-center gap-2" key={platform}>
                <Checkbox
                  id={`marketplace-platform-${platform}`}
                  checked={platforms.includes(platform)}
                  disabled={controlsDisabled}
                  onCheckedChange={() =>
                    setPlatforms((current) => togglePlatform(current, platform))
                  }
                />
                <Label
                  htmlFor={`marketplace-platform-${platform}`}
                  className="font-normal"
                >
                  {platform}
                </Label>
              </div>
            ))}
          </fieldset>
        </div>

        <div className="dialog-actions create-profile-actions">
          <button
            className="btn"
            type="button"
            onClick={requestClose}
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
            {busy ? (mode === "add" ? "Adding…" : "Saving…") : submitLabel}
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
