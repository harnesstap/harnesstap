import { useEffect, useMemo, useState } from "react";
import {
  AgentApiError,
  createProfile,
  fetchLibraryLayers,
  fetchLibraryResources,
  previewProfileCreate,
} from "../lib/agent-client";
import type {
  LibraryLayer,
  LibraryResource,
  ProfileConflictPolicy,
  ProfileCreatePreview,
  ProfileCreateRequest,
  ProfileCreateSource,
} from "../lib/types";

interface CreateProfileDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string;
  disabled?: boolean;
  onClose: () => void;
  onCreated: (
    profileName: string,
    switchAfterCreate: boolean,
  ) => void | Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError && error.code === "layer_exists") {
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
  onClose,
  onCreated,
}: CreateProfileDrawerProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<ProfileCreateSource>("compose");
  const [layerIds, setLayerIds] = useState<string[]>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [layers, setLayers] = useState<LibraryLayer[]>([]);
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
    setName("");
    setDescription("");
    setSource("compose");
    setLayerIds([]);
    setResourceIds([]);
    setPreview(null);
    setConflictPolicy("skip");
    setSwitchAfterCreate(false);
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
      fetchLibraryLayers(baseUrl, token),
      fetchLibraryResources(baseUrl, token),
    ])
      .then(([nextLayers, nextResources]) => {
        if (!cancelled) {
          setLayers(nextLayers);
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
          && layerIds.length + resourceIds.length > 0
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
    layerIds.length,
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
        return { ...common, source, layerIds, resourceIds };
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
    if (!baseUrl || !canContinue) {
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
    if (!baseUrl || !preview) {
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
          <label className="form-field">
            <span>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                invalidatePreview();
              }}
              disabled={controlsDisabled}
              placeholder="engineering"
            />
          </label>
          <label className="form-field">
            <span>Description <span className="muted">(optional)</span></span>
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                invalidatePreview();
              }}
              disabled={controlsDisabled}
              rows={2}
              placeholder="Shared tools for engineering work"
            />
          </label>

          <fieldset className="source-picker" disabled={controlsDisabled}>
            <legend>Source</legend>
            {(["compose", "home", "project"] as const).map((value) => (
              <label
                key={value}
                className={`source-option${source === value ? " selected" : ""}`}
              >
                <input
                  type="radio"
                  name="profile-source"
                  value={value}
                  checked={source === value}
                  disabled={value === "project" && !projectPath}
                  onChange={() => {
                    setSource(value);
                    invalidatePreview();
                  }}
                />
                <span>
                  <strong>
                    {value === "compose"
                      ? "Compose"
                      : value === "home"
                        ? "From home"
                        : "From project"}
                  </strong>
                  <small>
                    {value === "compose"
                      ? "Select existing layers and resources."
                      : value === "home"
                        ? "Import detected harness configuration."
                        : "Import configuration from the selected project."}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>

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
                    title="Layers"
                    emptyLabel="No layers available."
                    rows={layers}
                    selectedIds={layerIds}
                    disabled={controlsDisabled}
                    onToggle={(id) =>
                      toggleSelection(id, layerIds, setLayerIds)}
                  />
                  <SelectionList
                    title="Resources"
                    emptyLabel="No resources available."
                    rows={resources}
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
                    className="conflict-policy"
                    disabled={controlsDisabled}
                  >
                    <legend>When a resource already exists</legend>
                    {(["skip", "overwrite"] as const).map((policy) => (
                      <label key={policy}>
                        <input
                          type="radio"
                          name="conflict-policy"
                          checked={conflictPolicy === policy}
                          onChange={() => setConflictPolicy(policy)}
                        />
                        {policy === "skip"
                          ? "Keep the library version"
                          : "Overwrite with imported content"}
                      </label>
                    ))}
                  </fieldset>
                </>
              ) : null}
              <label className="switch-after-create">
                <input
                  type="checkbox"
                  checked={switchAfterCreate}
                  onChange={(event) =>
                    setSwitchAfterCreate(event.target.checked)}
                  disabled={controlsDisabled}
                />
                Switch after create
              </label>
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
              className="btn primary"
              type="button"
              onClick={() => void runCreate()}
              disabled={controlsDisabled}
            >
              {busy ? "Creating…" : "Create profile"}
            </button>
          ) : (
            <button
              className="btn primary"
              type="button"
              onClick={() => void runPreview()}
              disabled={!canContinue || controlsDisabled}
            >
              {busy ? "Previewing…" : "Continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface SelectionRow {
  id: string;
  name: string;
  description: string | null;
}

interface SelectionListProps {
  title: string;
  emptyLabel: string;
  rows: SelectionRow[];
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}

function SelectionList({
  title,
  emptyLabel,
  rows,
  selectedIds,
  disabled,
  onToggle,
}: SelectionListProps) {
  return (
    <fieldset className="selection-list" disabled={disabled}>
      <legend>{title}</legend>
      <div className="selection-list-rows">
        {rows.length === 0 ? (
          <p className="muted">{emptyLabel}</p>
        ) : (
          rows.map((row) => (
            <label key={row.id} className="selection-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(row.id)}
                onChange={() => onToggle(row.id)}
              />
              <span>
                <strong>{row.name}</strong>
                {row.description ? <small>{row.description}</small> : null}
              </span>
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
}
