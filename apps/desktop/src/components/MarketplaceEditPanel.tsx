import { useEffect, useRef, useState } from "react";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMarketplace, fetchMarketplaceSourceBranches, fetchMarketplaceTypeDetection } from "../lib/agent-client";
import { patchMarketplace } from "../lib/api/sources";
import {
  extraTrackedBranches,
  marketplaceDraftIsDirty,
  marketplaceSourceLooksResolvable,
  marketplaceSubmitCloseAction,
} from "../lib/sources-panels";
import type {
  MarketplaceTypeDetectResult,
  PluginMarketplaceEntry,
  PluginMarketplacePlatform,
} from "../lib/types";
import { Check, FolderOpen, Plus, X } from "lucide-react";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { FullScreenPanel } from "./FullScreenPanel";
import { IconActionButton } from "./IconActionButton";
import { MarketplaceTrackedBranchesField } from "./MarketplaceTrackedBranchesField";

const BRANCH_LIST_DEBOUNCE_MS = 400;

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
  const [platforms, setPlatforms] = useState<PluginMarketplacePlatform[]>([]);
  const [trackedBranches, setTrackedBranches] = useState<string[]>([]);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [typeDetection, setTypeDetection] = useState<MarketplaceTypeDetectResult | null>(
    null,
  );
  const [typeDetecting, setTypeDetecting] = useState(false);
  const [baselineUrl, setBaselineUrl] = useState("");
  const [baselineName, setBaselineName] = useState("");
  const [baselinePlatforms, setBaselinePlatforms] = useState<
    PluginMarketplacePlatform[]
  >([]);
  const [baselineTrackedBranches, setBaselineTrackedBranches] = useState<string[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const branchListGeneration = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && entry) {
      const nextPlatforms = [...(entry.platforms ?? [])];
      const nextBranches = [...(entry.trackedBranches ?? [])];
      setUrl(entry.url);
      setName(entry.name);
      setNameTouched(true);
      setPlatforms(nextPlatforms);
      setTrackedBranches(nextBranches);
      setBaselineUrl(entry.url);
      setBaselineName(entry.name);
      setBaselinePlatforms(nextPlatforms);
      setBaselineTrackedBranches(nextBranches);
    } else {
      setUrl("");
      setName("");
      setNameTouched(false);
      setPlatforms([]);
      setTrackedBranches([]);
      setBaselineUrl("");
      setBaselineName("");
      setBaselinePlatforms([]);
      setBaselineTrackedBranches([]);
    }
    setBranchOptions([]);
    setDefaultBranch(null);
    setBranchesLoading(false);
    setTypeDetection(null);
    setTypeDetecting(false);
    setBusy(false);
    setError(null);
    setWarning(null);
    setDiscardOpen(false);
  }, [open, mode, entry]);

  useEffect(() => {
    if (!open || !baseUrl) {
      return;
    }
    const source = url.trim();
    if (!marketplaceSourceLooksResolvable(source)) {
      branchListGeneration.current += 1;
      setBranchOptions([]);
      setDefaultBranch(null);
      setBranchesLoading(false);
      setTypeDetection(null);
      setTypeDetecting(false);
      setPlatforms([]);
      return;
    }
    const generation = ++branchListGeneration.current;
    const timer = window.setTimeout(() => {
      setBranchesLoading(true);
      setTypeDetecting(true);
      void fetchMarketplaceSourceBranches(baseUrl, token, source)
        .then((result) => {
          if (generation !== branchListGeneration.current) {
            return;
          }
          setBranchOptions(result.branches);
          setDefaultBranch(result.defaultBranch);
          setTrackedBranches((current) => {
            const known = new Set(result.branches);
            return current.filter((branch) => known.has(branch));
          });
        })
        .catch(() => {
          if (generation !== branchListGeneration.current) {
            return;
          }
          setBranchOptions([]);
          setDefaultBranch(null);
        })
        .finally(() => {
          if (generation === branchListGeneration.current) {
            setBranchesLoading(false);
          }
        });
      void fetchMarketplaceTypeDetection(baseUrl, token, source)
        .then((result) => {
          if (generation !== branchListGeneration.current) {
            return;
          }
          setTypeDetection(result);
          setPlatforms(result.status === "inferred" ? [...result.platforms] : []);
        })
        .catch((detectError: unknown) => {
          if (generation !== branchListGeneration.current) {
            return;
          }
          setTypeDetection({
            status: "error",
            platforms: [],
            manifests: [],
            message: errorMessage(detectError, "Could not detect marketplace type."),
          });
          setPlatforms([]);
        })
        .finally(() => {
          if (generation === branchListGeneration.current) {
            setTypeDetecting(false);
          }
        });
    }, BRANCH_LIST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, url, baseUrl, token]);

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy || !baseUrl;
  const resolvedName = name.trim() || deriveMarketplaceNameFromUrl(url);
  const canSubmit =
    Boolean(url.trim())
    && Boolean(resolvedName)
    && !typeDetecting
    && typeDetection?.status === "inferred"
    && platforms.length > 0;
  const dirty = marketplaceDraftIsDirty({
    url,
    name,
    platforms,
    trackedBranches,
    baselineUrl,
    baselineName,
    baselinePlatforms,
    baselineTrackedBranches,
  });
  const sourceReady = marketplaceSourceLooksResolvable(url);

  const onUrlChange = (nextUrl: string) => {
    setUrl(nextUrl);
    if (mode === "add" && !nameTouched) {
      setName(deriveMarketplaceNameFromUrl(nextUrl));
    }
  };

  const browseLocalRepo = async () => {
    try {
      const selected = await openDirectoryDialog({
        directory: true,
        multiple: false,
        title: "Select local git marketplace",
        defaultPath: url.trim() || undefined,
      });
      if (typeof selected === "string" && selected.length > 0) {
        onUrlChange(selected);
      }
    } catch {
      // Web / cancelled: keep the typed URL or path.
    }
  };

  const markClean = (nextUrl: string, nextName: string, nextBranches: string[]) => {
    setBaselineUrl(nextUrl);
    setBaselineName(nextName);
    setBaselinePlatforms([...platforms]);
    setBaselineTrackedBranches([...nextBranches]);
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
    nextBranches: string[],
  ): boolean => {
    if (marketplaceSubmitCloseAction(refresh) === "stay-warning" && refresh) {
      setWarning(refresh.message);
      markClean(nextUrl, nextName, nextBranches);
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
    const nextBranches = extraTrackedBranches(trackedBranches, defaultBranch);
    try {
      if (mode === "add") {
        const result = await addMarketplace(baseUrl, token, {
          url: nextUrl,
          name: nextName,
          platforms,
          ...(nextBranches.length > 0 ? { trackedBranches: nextBranches } : {}),
        });
        applyRefreshOutcome(
          result.refresh,
          result.status === "already_configured"
            ? "Marketplace already configured."
            : "Marketplace added.",
          nextUrl,
          nextName,
          nextBranches,
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
        trackedBranches: nextBranches,
      });
      applyRefreshOutcome(
        result.refresh,
        "Marketplace updated.",
        nextUrl,
        nextName,
        nextBranches,
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
    <>
    <FullScreenPanel
      titleId="marketplace-edit-title"
      title={title}
      eyebrow="Discover"
      closeLabel={mode === "add" ? "Close add marketplace" : "Close edit marketplace"}
      closeDisabled={controlsDisabled}
      onClose={requestClose}
      testId="marketplace-edit-panel"
      actions={
        <>
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
            {busy ? <ButtonSpinner size={16} /> : mode === "add" ? <Plus size={16} aria-hidden /> : <Check size={16} aria-hidden />}
            {busy ? (mode === "add" ? "Adding…" : "Saving…") : submitLabel}
          </button>
        </>
      }
    >
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
            <Label htmlFor="marketplace-edit-url">URL or path</Label>
            <div className="marketplace-source-row">
              <Input
                id="marketplace-edit-url"
                data-testid="marketplace-url"
                autoFocus={mode === "add"}
                value={url}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://github.com/org/marketplace or /path/to/repo"
                disabled={controlsDisabled}
              />
              <IconActionButton
                label="Choose folder"
                disabled={controlsDisabled}
                onClick={() => void browseLocalRepo()}
                icon={<FolderOpen size={16} aria-hidden />}
              />
            </div>
          </div>
          <div className="form-field gap-1.5">
            <Label htmlFor="marketplace-edit-name">Name</Label>
            <Input
              id="marketplace-edit-name"
              data-testid="marketplace-name"
              value={name}
              onChange={(event) => {
                setNameTouched(true);
                setName(event.target.value);
              }}
              placeholder="my-marketplace"
              disabled={controlsDisabled}
            />
          </div>
          <div className="form-field gap-1.5">
            <Label htmlFor="marketplace-tracked-branches">Tracked branches</Label>
            <MarketplaceTrackedBranchesField
              id="marketplace-tracked-branches"
              selected={trackedBranches}
              branches={branchOptions}
              defaultBranch={defaultBranch}
              disabled={controlsDisabled}
              loading={branchesLoading}
              sourceReady={sourceReady}
              onChange={setTrackedBranches}
            />
            <p className="muted">Empty tracks the default branch only. Extra branches are opt-in.</p>
          </div>
          <div className="form-field gap-1.5">
            <Label id="marketplace-type-label">Type</Label>
            {typeDetecting ? (
              <p
                className="muted"
                role="status"
                data-testid="marketplace-type-status"
                aria-labelledby="marketplace-type-label"
              >
                Detecting type…
              </p>
            ) : typeDetection?.status === "error" ? (
              <div
                className="banner error"
                role="alert"
                data-testid="marketplace-type-status"
              >
                {typeDetection.message}
              </div>
            ) : typeDetection?.status === "ambiguous" ? (
              <div
                className="banner"
                role="status"
                data-testid="marketplace-type-status"
              >
                {typeDetection.message}
              </div>
            ) : (
              <p
                className="muted"
                role="status"
                data-testid="marketplace-type-status"
                aria-labelledby="marketplace-type-label"
              >
                {typeDetection?.message ?? "Type is inferred from the URL or path."}
              </p>
            )}
          </div>
    </FullScreenPanel>
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
    </>
  );
}
