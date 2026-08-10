import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  fetchLibraryPlugins,
  fetchLibraryResources,
  migrateExport,
} from "../lib/agent-client";
import {
  defaultMigrateExportFilename,
  formatResourceSelector,
} from "../lib/migrate-defaults";
import { filterLibraryResourcesBySearch } from "../lib/resource-search";
import type {
  LibraryPlugin,
  LibraryResource,
  MigrateExportResult,
  MigrateScope,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";

export interface MigrateExportDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onExported?: (result: MigrateExportResult) => void;
  onBusyChange?: (busy: boolean) => void;
}

type ExportStep = "scope" | "target" | "options" | "path" | "confirm";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function scopeLabel(scope: MigrateScope): string {
  switch (scope) {
    case "workspace":
      return "Full workspace";
    case "plugin":
      return "Plugin";
    case "resource":
      return "Resource";
    default: {
      const neverScope: never = scope;
      return neverScope;
    }
  }
}

function stepAfterScope(scope: MigrateScope): ExportStep {
  return scope === "workspace" ? "options" : "target";
}

function stepAfterTarget(scope: MigrateScope): ExportStep {
  return scope === "workspace" || scope === "plugin" ? "options" : "path";
}

function previousStep(step: ExportStep, scope: MigrateScope): ExportStep | null {
  switch (step) {
    case "scope":
      return null;
    case "target":
      return "scope";
    case "options":
      return scope === "workspace" ? "scope" : "target";
    case "path":
      return scope === "workspace" || scope === "plugin" ? "options" : "target";
    case "confirm":
      return "path";
    default: {
      const neverStep: never = step;
      return neverStep;
    }
  }
}

function nextStep(step: ExportStep, scope: MigrateScope): ExportStep | null {
  switch (step) {
    case "scope":
      return stepAfterScope(scope);
    case "target":
      return stepAfterTarget(scope);
    case "options":
      return "path";
    case "path":
      return "confirm";
    case "confirm":
      return null;
    default: {
      const neverStep: never = step;
      return neverStep;
    }
  }
}

function stepTitle(step: ExportStep): string {
  switch (step) {
    case "scope":
      return "What to export";
    case "target":
      return "Choose export target";
    case "options":
      return "Export options";
    case "path":
      return "Output file";
    case "confirm":
      return "Confirm export";
    default: {
      const neverStep: never = step;
      return neverStep;
    }
  }
}

function isExportableResource(resource: LibraryResource): boolean {
  return resource.type !== "plugin_pin" && resource.type !== "plugin";
}

export function MigrateExportDrawer({
  open,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onExported,
  onBusyChange,
}: MigrateExportDrawerProps) {
  const [step, setStep] = useState<ExportStep>("scope");
  const [scope, setScope] = useState<MigrateScope>("workspace");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  const [includePlugins, setIncludePlugins] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [targetFilter, setTargetFilter] = useState("");
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([]);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setStep("scope");
    setScope("workspace");
    setSelectedPlugin(null);
    setSelectedResource(null);
    setIncludePlugins(false);
    setExportPath(null);
    setTargetFilter("");
    setLibraryError(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !baseUrl) {
      return;
    }
    let cancelled = false;
    setLibraryLoading(true);
    setLibraryError(null);
    void Promise.all([
      fetchLibraryPlugins(baseUrl, token),
      fetchLibraryResources(baseUrl, token),
    ])
      .then(([nextPlugins, nextResources]) => {
        if (!cancelled) {
          setPlugins(nextPlugins);
          setResources(nextResources);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setLibraryError(
            errorMessage(loadError, "Could not load the local library."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLibraryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, open, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !disabled) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, disabled, onClose, open]);

  const exportableResources = useMemo(
    () => resources.filter(isExportableResource),
    [resources],
  );

  const filteredPlugins = useMemo(() => {
    const query = targetFilter.trim().toLowerCase();
    if (!query) {
      return plugins;
    }
    return plugins.filter((plugin) =>
      plugin.name.toLowerCase().includes(query)
      || (plugin.description ?? "").toLowerCase().includes(query),
    );
  }, [plugins, targetFilter]);

  const filteredResources = useMemo(
    () => filterLibraryResourcesBySearch(exportableResources, targetFilter),
    [exportableResources, targetFilter],
  );

  const targetSelected = useMemo(() => {
    switch (scope) {
      case "plugin":
        return selectedPlugin !== null;
      case "resource":
        return selectedResource !== null;
      case "workspace":
        return true;
      default: {
        const neverScope: never = scope;
        return neverScope;
      }
    }
  }, [scope, selectedPlugin, selectedResource]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case "scope":
        return true;
      case "target":
        return !libraryLoading && targetSelected;
      case "options":
        return true;
      case "path":
        return exportPath !== null && exportPath.trim().length > 0;
      case "confirm":
        return false;
      default: {
        const neverStep: never = step;
        return neverStep;
      }
    }
  }, [exportPath, libraryLoading, step, targetSelected]);

  const defaultFilename = useMemo(
    () =>
      defaultMigrateExportFilename({
        scope,
        plugin: selectedPlugin ?? undefined,
        resource: selectedResource ?? undefined,
      }),
    [scope, selectedPlugin, selectedResource],
  );

  const pickExportPath = async () => {
    const filters =
      scope === "workspace"
        ? [
            { name: "Archive", extensions: ["tar.gz", "gz", "tar"] },
            { name: "JSON", extensions: ["json"] },
          ]
        : [{ name: "Agent Plugins", extensions: ["ap.json", "json"] }];
    const path = await save({
      defaultPath: defaultFilename,
      filters,
    });
    if (path) {
      setExportPath(path);
      setError(null);
    }
  };

  const runExport = async () => {
    if (!baseUrl || !exportPath || busy) {
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const result = await migrateExport(baseUrl, token, {
        scope,
        path: exportPath,
        ...(scope === "plugin" && selectedPlugin ? { plugin: selectedPlugin } : {}),
        ...(scope === "resource" && selectedResource
          ? { resource: selectedResource }
          : {}),
        ...((scope === "workspace" || scope === "plugin") && includePlugins
          ? { include_plugins: true }
          : {}),
        ...(scope === "plugin" || scope === "resource"
          ? { single_file: true }
          : {}),
      });
      onExported?.(result);
      onClose();
    } catch (exportError) {
      setError(errorMessage(exportError, "Could not export."));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy;
  const showBack = previousStep(step, scope) !== null;

  const renderTargetStep = () => {
    if (libraryLoading) {
      return <p className="muted">Loading local library…</p>;
    }
    if (libraryError) {
      return <div className="banner error">{libraryError}</div>;
    }

    const listboxLabel = scope === "plugin" ? "Plugins" : "Resources";

    return (
      <>
        <div className="form-field gap-1.5">
          <Label htmlFor="migrate-export-target-filter">Filter</Label>
          <Input
            id="migrate-export-target-filter"
            autoFocus
            value={targetFilter}
            onChange={(event) => setTargetFilter(event.target.value)}
            disabled={controlsDisabled}
            placeholder="Search by name"
          />
        </div>
        <div
          className="cloud-results migrate-export-targets"
          role="listbox"
          aria-label={listboxLabel}
        >
          {scope === "plugin" ? (
            filteredPlugins.length === 0 ? (
              <p className="muted cloud-list-message">No plugins found.</p>
            ) : (
              filteredPlugins.map((plugin) => (
                <button
                  key={plugin.id}
                  className={`cloud-result${
                    selectedPlugin === plugin.name ? " selected" : ""
                  }`}
                  type="button"
                  role="option"
                  aria-selected={selectedPlugin === plugin.name}
                  onClick={() => {
                    setSelectedPlugin(plugin.name);
                    setExportPath(null);
                    setError(null);
                  }}
                  disabled={controlsDisabled}
                >
                  <strong>{plugin.name}</strong>
                  <small>
                    {plugin.description?.trim() || "No description provided."}
                  </small>
                </button>
              ))
            )
          ) : null}
          {scope === "resource" ? (
            filteredResources.length === 0 ? (
              <p className="muted cloud-list-message">No resources found.</p>
            ) : (
              filteredResources.map((resource) => {
                const selector = formatResourceSelector(resource);
                return (
                  <button
                    key={resource.id}
                    className={`cloud-result${
                      selectedResource === selector ? " selected" : ""
                    }`}
                    type="button"
                    role="option"
                    aria-selected={selectedResource === selector}
                    onClick={() => {
                      setSelectedResource(selector);
                      setExportPath(null);
                      setError(null);
                    }}
                    disabled={controlsDisabled}
                  >
                    <strong>
                      {selector}
                      <span className="pill cloud-kind-pill">{resource.type}</span>
                    </strong>
                    <small>
                      {resource.description?.trim() || "No description provided."}
                    </small>
                  </button>
                );
              })
            )
          ) : null}
        </div>
      </>
    );
  };

  const targetSummary = () => {
    switch (scope) {
      case "plugin":
        return selectedPlugin ?? "—";
      case "resource":
        return selectedResource ?? "—";
      case "workspace":
        return "Entire local library";
      default: {
        const neverScope: never = scope;
        return neverScope;
      }
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
        className="dialog create-profile-dialog migrate-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="migrate-export-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Migrate</div>
            <h2 id="migrate-export-title">Export</h2>
            <p className="muted">{stepTitle(step)}</p>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close export drawer"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body migrate-export-body">
          {step === "scope" ? (
            <RadioGroup
              value={scope}
              onValueChange={(value) => {
                const nextScope = value as MigrateScope;
                setScope(nextScope);
                setSelectedPlugin(null);
                setSelectedResource(null);
                setExportPath(null);
                setError(null);
              }}
              disabled={controlsDisabled}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="workspace" id="migrate-scope-workspace" />
                <Label htmlFor="migrate-scope-workspace" className="font-normal">
                  Full workspace (archive)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="plugin" id="migrate-scope-plugin" />
                <Label htmlFor="migrate-scope-plugin" className="font-normal">
                  Plugin package (.ap.json)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="resource" id="migrate-scope-resource" />
                <Label htmlFor="migrate-scope-resource" className="font-normal">
                  Single resource (.ap.json)
                </Label>
              </div>
            </RadioGroup>
          ) : null}

          {step === "target" ? renderTargetStep() : null}

          {step === "options" ? (
            <div className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="migrate-export-include-plugins">
                  Embed plugin trees
                </Label>
                <p className="muted m-0 text-[11px]">
                  Include plugin directory trees in plugin exports.
                </p>
              </div>
              <Switch
                id="migrate-export-include-plugins"
                checked={includePlugins}
                onCheckedChange={setIncludePlugins}
                disabled={controlsDisabled}
              />
            </div>
          ) : null}

          {step === "path" ? (
            <div className="form-field gap-2">
              <Label>Save export as</Label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn"
                  type="button"
                  onClick={() => void pickExportPath()}
                  disabled={controlsDisabled}
                >
                  Choose file…
                </button>
                <span className="mono text-xs">
                  {exportPath ?? "No file selected"}
                </span>
              </div>
              <p className="muted m-0 text-[11px]">
                Suggested name: <span className="mono">{defaultFilename}</span>
              </p>
            </div>
          ) : null}

          {step === "confirm" ? (
            <dl className="migrate-export-summary m-0 grid gap-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Scope</dt>
                <dd className="m-0 text-right">{scopeLabel(scope)}</dd>
              </div>
              {scope !== "workspace" ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Target</dt>
                  <dd className="m-0 text-right mono">{targetSummary()}</dd>
                </div>
              ) : null}
              {scope === "workspace" || scope === "plugin" ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Embed plugin trees</dt>
                  <dd className="m-0 text-right">
                    {includePlugins ? "Yes" : "No"}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Output</dt>
                <dd className="m-0 text-right mono">{exportPath}</dd>
              </div>
            </dl>
          ) : null}

          {error ? <div className="banner error">{error}</div> : null}
        </div>

        <div className="dialog-actions create-profile-actions">
          {showBack ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                const prev = previousStep(step, scope);
                if (prev) {
                  setStep(prev);
                  setError(null);
                }
              }}
              disabled={controlsDisabled}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            Cancel
          </button>
          {step === "confirm" ? (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={() => void runExport()}
              disabled={controlsDisabled || !exportPath}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Exporting…" : "Export"}
            </button>
          ) : (
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                const next = nextStep(step, scope);
                if (next) {
                  setStep(next);
                  setError(null);
                }
              }}
              disabled={controlsDisabled || !canGoNext}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
