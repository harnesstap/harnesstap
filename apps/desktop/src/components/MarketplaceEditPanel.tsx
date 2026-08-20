import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMarketplace } from "../lib/agent-client";
import { patchMarketplace } from "../lib/api/sources";
import type {
  PluginMarketplaceEntry,
  PluginMarketplacePlatform,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";

const MARKETPLACE_PLATFORMS: PluginMarketplacePlatform[] = [
  "claude-code",
  "cursor",
  "goose",
  "copilot-cli",
];

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
}: MarketplaceEditPanelProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [platforms, setPlatforms] = useState<PluginMarketplacePlatform[]>([
    "claude-code",
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && entry) {
      setUrl(entry.url);
      setName(entry.name);
      setNameTouched(true);
      setPlatforms(
        entry.platforms.length > 0 ? [...entry.platforms] : ["claude-code"],
      );
    } else {
      setUrl("");
      setName("");
      setNameTouched(false);
      setPlatforms(["claude-code"]);
    }
    setBusy(false);
    setError(null);
  }, [open, mode, entry]);

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy || !baseUrl;
  const resolvedName = name.trim() || deriveMarketplaceNameFromUrl(url);
  const canSubmit =
    Boolean(url.trim()) && Boolean(resolvedName) && platforms.length > 0;

  const onUrlChange = (nextUrl: string) => {
    setUrl(nextUrl);
    if (mode === "add" && !nameTouched) {
      setName(deriveMarketplaceNameFromUrl(nextUrl));
    }
  };

  const onSubmit = async () => {
    if (!baseUrl || !canSubmit || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "add") {
        const result = await addMarketplace(baseUrl, token, {
          url: url.trim(),
          name: resolvedName,
          platforms,
        });
        onSaved(
          result.status === "already_configured"
            ? "Marketplace already configured."
            : "Marketplace added.",
        );
        onClose();
        return;
      }
      if (!entry) {
        return;
      }
      await patchMarketplace(baseUrl, token, entry.name, {
        name: resolvedName,
        url: url.trim(),
        platforms,
      });
      onSaved("Marketplace updated.");
      onClose();
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
          onClose();
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
            {busy ? (mode === "add" ? "Adding…" : "Saving…") : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
