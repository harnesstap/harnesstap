import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SourcePicker } from "@/components/ui/source-picker";
import {
  AgentApiError,
  createProfile,
  fetchLibraryPlugins,
  fetchLibraryResources,
  previewProfileCreate,
} from "../lib/agent-client";
import type {
  LibraryPlugin,
  LibraryResource,
  ProfileConflictPolicy,
  ProfileCreatePreview,
  ProfileCreateRequest,
  ProfileCreateSource,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import {
  ResourceSelectionList,
  SelectionList,
} from "./CompositionPickers";

/** Create-profile drawer: compose / home / project sources. */
interface CreateProfileDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string;
  disabled?: boolean;
  /** Prefill source when the drawer opens (e.g. untracked-project CTA). */
  initialSource?: ProfileCreateSource;
  /** Prefill “Switch after create” when the drawer opens. */
  initialSwitchAfterCreate?: boolean;
  onClose: () => void;
  onCreated: (
    profileName: string,
    switchAfterCreate: boolean,
  ) => void | Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError && error.code === "plugin_exists") {
    return "A profile with this name already exists.";
  }
  return error instanceof Error ? error.message : fallback;
}

function conflictLabel(conflict: unknown, index: number): string {
  if (typeof conflict !== "object" || conflict === null) {
    return String(conflict);
  }
  const row = conflict as Record<string, unknown>;
  if (typeof row.name === "string") {
    const type = typeof row.type === "string" ? `${row.type}: ` : "";
    return `${type}${row.name}`;
  }
  if (
    typeof row.existingResource === "object"
    && row.existingResource !== null
  ) {
    const resource = row.existingResource as Record<string, unknown>;
    if (typeof resource.name === "string") {
      const type =
        typeof resource.type === "string" ? `${resource.type}: ` : "";
      return `${type}${resource.name}`;
    }
  }
  return `Conflict ${index + 1}`;
}

export function CreateProfileDrawer({
  open,
  baseUrl,
  token,
  projectPath,
  disabled = false,
  initialSource = "compose",
  initialSwitchAfterCreate = false,
  onClose,
  onCreated,
}: CreateProfileDrawerProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<ProfileCreateSource>("compose");
  const [pluginIds, setPluginIds] = useState<string[]>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [resourceFilter, setResourceFilter] = useState("");
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([]);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProfileCreatePreview | null>(null);
  const [conflictPolicy, setConflictPolicy] =
    useState<ProfileConflictPolicy>("skip");
  const [switchAfterCreate, setSwitchAfterCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const resolvedSource =
      initialSource === "project" && !projectPath.trim()
        ? "compose"
        : initialSource;
    setName("");
    setDescription("");
    setSource(resolvedSource);
    setPluginIds([]);
    setResourceIds([]);
    setResourceFilter("");
    setPreview(null);
    setConflictPolicy("skip");
    setSwitchAfterCreate(initialSwitchAfterCreate);
    setError(null);
  }, [initialSource, initialSwitchAfterCreate, open, projectPath]);

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

  const canContinue = useMemo(() => {
    if (!baseUrl || !token || !name.trim()) {
      return false;
    }
    switch (source) {
      case "compose":
        return (
          !libraryLoading
          && pluginIds.length + resourceIds.length > 0
        );
      case "home":
        return true;
      case "project":
        return projectPath.length > 0;
      default: {
        const neverSource: never = source;
        return neverSource;
      }
    }
  }, [
    baseUrl,
    pluginIds.length,
    libraryLoading,
    name,
    projectPath,
    resourceIds.length,
    source,
    token,
  ]);

  const buildRequest = (use: boolean): ProfileCreateRequest => {
    const common = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      use,
    };
    switch (source) {
      case "compose":
        return { ...common, source, pluginIds, resourceIds };
      case "home":
        return { ...common, source, conflictPolicy };
      case "project":
        return { ...common, source, projectPath, conflictPolicy };
      default: {
        const neverSource: never = source;
        return neverSource;
      }
    }
  };

  const invalidatePreview = () => {
    setPreview(null);
    setError(null);
  };

  const toggleSelection = (
    id: string,
    selected: string[],
    update: (ids: string[]) => void,
  ) => {
    update(
      selected.includes(id)
        ? selected.filter((selectedId) => selectedId !== id)
        : [...selected, id],
    );
    invalidatePreview();
  };

  const runPreview = async () => {
    if (!baseUrl || !canContinue || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewProfileCreate(baseUrl, token, buildRequest(false)));
    } catch (previewError) {
      setError(errorMessage(previewError, "Could not preview profile."));
    } finally {
      setBusy(false);
    }
  };

  const runCreate = async () => {
    if (!baseUrl || !preview || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createProfile(
        baseUrl,
        token,
        buildRequest(false),
      );
      await onCreated(result.profile.name, switchAfterCreate);
      onClose();
    } catch (createError) {
      setError(errorMessage(createError, "Could not create profile."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy;

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
        aria-labelledby="create-profile-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Profile library</div>
            <h2 id="create-profile-title">Create profile</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close create profile"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body">
          <div className="form-field gap-1.5">
            <Label htmlFor="create-profile-name">Name</Label>
            <Input
              id="create-profile-name"
              data-testid="create-profile-name"
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                invalidatePreview();
              }}
              disabled={controlsDisabled}
              placeholder="engineering"
            />
          </div>
          <div className="form-field gap-1.5">
            <Label htmlFor="create-profile-description">
              Description <span className="muted">(optional)</span>
            </Label>
            <Textarea
              id="create-profile-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                invalidatePreview();
              }}
              disabled={controlsDisabled}
              rows={2}
              placeholder="Shared tools for engineering work"
            />
          </div>

          <SourcePicker
            legend="Source"
            value={source}
            disabled={controlsDisabled}
            onValueChange={(next) => {
              setSource(next as ProfileCreateSource);
              invalidatePreview();
            }}
            options={[
              {
                value: "compose",
                title: "Compose",
                description: "Select existing plugins and resources.",
                testId: "create-source-compose",
              },
              {
                value: "home",
                title: "From global",
                description: "Import detected global harness configuration.",
              },
              {
                value: "project",
                title: "From project",
                description: "Import configuration from the selected project.",
                disabled: !projectPath,
              },
            ]}
          />

          {!projectPath ? (
            <p className="field-note muted">
              Choose a project in the top bar to enable From project.
            </p>
          ) : null}

          {source === "compose" ? (
            <div className="compose-library">
              {libraryLoading ? (
                <p className="muted">Loading local library…</p>
              ) : libraryError ? (
                <div className="banner error">{libraryError}</div>
              ) : (
                <>
                  <SelectionList
                    title="Plugins"
                    emptyLabel="No plugins available."
                    rows={plugins}
                    selectedIds={pluginIds}
                    disabled={controlsDisabled}
                    onToggle={(id) =>
                      toggleSelection(id, pluginIds, setPluginIds)}
                  />
                  <ResourceSelectionList
                    resources={resources}
                    filter={resourceFilter}
                    onFilterChange={setResourceFilter}
                    selectedIds={resourceIds}
                    disabled={controlsDisabled}
                    onToggle={(id) =>
                      toggleSelection(id, resourceIds, setResourceIds)}
                  />
                </>
              )}
            </div>
          ) : null}

          {preview ? (
            <section className="create-preview" aria-label="Create preview">
              <div className="preview-count">
                <span>Ready to import</span>
                <strong>{preview.totalImports}</strong>
              </div>
              {preview.warnings.map((warning) => (
                <div className="banner" key={warning}>{warning}</div>
              ))}
              {preview.conflicts.length > 0 ? (
                <>
                  <div>
                    <strong>{preview.conflicts.length} conflicts</strong>
                    <ul className="conflict-list">
                      {preview.conflicts.map((conflict, index) => (
                        <li key={`${conflictLabel(conflict, index)}-${index}`}>
                          {conflictLabel(conflict, index)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <fieldset
                    className="conflict-policy m-0 border-0 p-0"
                    disabled={controlsDisabled}
                  >
                    <legend className="mb-1.5 text-xs font-semibold">
                      When a resource already exists
                    </legend>
                    <RadioGroup
                      value={conflictPolicy}
                      onValueChange={(next) =>
                        setConflictPolicy(next as ProfileConflictPolicy)}
                      disabled={controlsDisabled}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem id="conflict-skip" value="skip" />
                        <Label htmlFor="conflict-skip" className="font-normal">
                          Keep the library version
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          id="conflict-overwrite"
                          value="overwrite"
                        />
                        <Label
                          htmlFor="conflict-overwrite"
                          className="font-normal"
                        >
                          Overwrite with imported content
                        </Label>
                      </div>
                    </RadioGroup>
                  </fieldset>
                </>
              ) : null}
              <div className="switch-after-create flex items-center gap-2 border-t border-border pt-2.5">
                <Switch
                  id="switch-after-create"
                  checked={switchAfterCreate}
                  onCheckedChange={setSwitchAfterCreate}
                  disabled={controlsDisabled}
                />
                <Label htmlFor="switch-after-create">Switch after create</Label>
              </div>
            </section>
          ) : null}

          {error ? <div className="banner error">{error}</div> : null}
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
          {preview ? (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              data-testid="create-profile-submit"
              onClick={() => void runCreate()}
              disabled={controlsDisabled}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Creating…" : "Create profile"}
            </button>
          ) : (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              data-testid="create-profile-submit"
              onClick={() => void runPreview()}
              disabled={!canContinue || controlsDisabled}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Previewing…" : "Continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

