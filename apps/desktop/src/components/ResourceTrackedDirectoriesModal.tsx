import { useCallback, useEffect, useId, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Plus, Trash2, X } from "lucide-react";
import {
  addResourceTrackedDirectory,
  fetchResourceTrackedDirectories,
  openResourcePath,
  removeResourceTrackedDirectory,
} from "../lib/agent-client";
import type { ResourceTrackedDirectoryEntry } from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { RelatedHarnessIcons } from "./HarnessIcons";

interface ResourceTrackedDirectoriesModalProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

function kindLabel(kind: ResourceTrackedDirectoryEntry["kind"]): string {
  switch (kind) {
    case "home_default":
      return "Home defaults";
    case "custom":
      return "Custom";
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

export function ResourceTrackedDirectoriesModal({
  open: isOpen,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onChanged,
}: ResourceTrackedDirectoriesModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [directories, setDirectories] = useState<ResourceTrackedDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    if (!baseUrl) {
      setDirectories([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchResourceTrackedDirectories(baseUrl, token);
      setDirectories(result.directories);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load tracked directories",
      );
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void reload();
  }, [isOpen, reload]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const handleAddDirectory = async () => {
    if (!baseUrl || disabled || adding) {
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select directory to track for resources",
      });
      if (typeof selected !== "string" || selected.length === 0) {
        return;
      }
      setAdding(true);
      setError(null);
      await addResourceTrackedDirectory(baseUrl, token, selected);
      await reload();
      onChanged?.();
    } catch (addError: unknown) {
      setError(
        addError instanceof Error
          ? addError.message
          : "Could not add tracked directory",
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveDirectory = async (path: string) => {
    if (!baseUrl || disabled || busyPath) {
      return;
    }
    setBusyPath(path);
    setError(null);
    try {
      await removeResourceTrackedDirectory(baseUrl, token, path);
      await reload();
      onChanged?.();
    } catch (removeError: unknown) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove tracked directory",
      );
    } finally {
      setBusyPath(null);
    }
  };

  const handleOpenFolder = async (path: string) => {
    if (!baseUrl || disabled || openingPath) {
      return;
    }
    setOpeningPath(path);
    setError(null);
    try {
      await openResourcePath(baseUrl, token, { path });
    } catch (openError: unknown) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Could not open folder",
      );
    } finally {
      setOpeningPath(null);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop resource-tracked-dirs-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog resource-tracked-dirs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="resource-tracked-dirs-header">
          <div>
            <h2 id={titleId}>Tracked directories</h2>
            <p className="muted resource-tracked-dirs-subtitle">
              Directories HarnessTap scans to import resources into the library.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-action"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {error ? (
          <div className="banner error resource-tracked-dirs-error">{error}</div>
        ) : null}

        <div className="resource-tracked-dirs-body">
          {loading ? (
            <p className="muted">Loading tracked directories…</p>
          ) : directories.length === 0 ? (
            <p className="muted">No tracked directories yet.</p>
          ) : (
            <ul className="resource-tracked-dirs-list">
              {directories.map((entry) => {
                const hasFolders = entry.folders.length > 0;
                const openBusy = openingPath === entry.path;
                const removeBusy = busyPath === entry.path;
                const actions = (
                  <div className="resource-tracked-dirs-item-actions">
                    <button
                      type="button"
                      className={[
                        "icon-action",
                        "resource-tracked-dirs-open",
                        openBusy ? "is-busy" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={`Open ${entry.path} in file manager`}
                      title="Open folder"
                      disabled={disabled || Boolean(openingPath)}
                      aria-busy={openBusy}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleOpenFolder(entry.path);
                      }}
                    >
                      {openBusy ? (
                        <ButtonSpinner size={14} />
                      ) : (
                        <FolderOpen size={14} aria-hidden />
                      )}
                    </button>
                    {entry.removable ? (
                      <button
                        type="button"
                        className={[
                          "icon-action",
                          "resource-tracked-dirs-remove",
                          removeBusy ? "is-busy" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-label={`Remove ${entry.path}`}
                        title="Stop tracking this directory"
                        disabled={disabled || busyPath === entry.path}
                        aria-busy={removeBusy}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleRemoveDirectory(entry.path);
                        }}
                      >
                        {removeBusy ? (
                          <ButtonSpinner size={14} />
                        ) : (
                          <Trash2 size={14} aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </div>
                );

                const main = (
                  <div className="resource-tracked-dirs-item-main">
                    <div className="resource-tracked-dirs-item-title">
                      <span>{entry.label}</span>
                      <RelatedHarnessIcons harnessIds={entry.platform_ids} />
                      <span className="resource-tracked-dirs-kind muted">
                        {kindLabel(entry.kind)}
                      </span>
                    </div>
                    <span className="mono resource-tracked-dirs-path muted">
                      {entry.display_path ?? entry.path}
                    </span>
                    <div className="resource-tracked-dirs-meta muted">
                      {entry.resource_count}{" "}
                      {entry.resource_count === 1 ? "resource" : "resources"}
                      {entry.platform_ids.length > 0
                        ? ` · ${entry.platform_ids.join(", ")}`
                        : null}
                      {hasFolders
                        ? ` · ${entry.folders.length} ${
                            entry.folders.length === 1 ? "folder" : "folders"
                          }`
                        : null}
                    </div>
                  </div>
                );

                if (!hasFolders) {
                  return (
                    <li className="resource-tracked-dirs-item" key={entry.path}>
                      {main}
                      {actions}
                    </li>
                  );
                }

                return (
                  <li
                    className="resource-tracked-dirs-item resource-tracked-dirs-item-expandable"
                    key={entry.path}
                  >
                    <details className="resource-tracked-dirs-details">
                      <summary className="resource-tracked-dirs-summary">
                        {main}
                        {actions}
                      </summary>
                      <ul className="resource-tracked-dirs-folders">
                        {entry.folders.map((folder) => {
                          const folderOpenBusy = openingPath === folder.path;
                          return (
                            <li
                              className="resource-tracked-dirs-folder"
                              key={folder.path}
                            >
                              <div className="resource-tracked-dirs-folder-main">
                                <div className="resource-tracked-dirs-folder-label">
                                  <span>{folder.label}</span>
                                  <RelatedHarnessIcons harnessIds={folder.platform_ids} />
                                </div>
                                <span className="mono resource-tracked-dirs-path muted">
                                  {folder.path}
                                </span>
                                {folder.platform_ids.length > 0 ? (
                                  <span className="resource-tracked-dirs-meta muted">
                                    {folder.platform_ids.join(", ")}
                                  </span>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className={[
                                  "icon-action",
                                  "resource-tracked-dirs-open",
                                  folderOpenBusy ? "is-busy" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                aria-label={`Open ${folder.path} in file manager`}
                                title="Open folder"
                                disabled={disabled || Boolean(openingPath)}
                                aria-busy={folderOpenBusy}
                                onClick={() => void handleOpenFolder(folder.path)}
                              >
                                {folderOpenBusy ? (
                                  <ButtonSpinner size={14} />
                                ) : (
                                  <FolderOpen size={14} aria-hidden />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="dialog-actions resource-tracked-dirs-actions">
          <button
            className={["btn", adding ? "is-busy" : ""].filter(Boolean).join(" ")}
            type="button"
            disabled={disabled || !baseUrl || adding}
            aria-busy={adding}
            onClick={() => void handleAddDirectory()}
          >
            {adding ? <ButtonSpinner size={14} /> : <Plus size={14} aria-hidden />}
            {adding ? "Adding…" : "Add directory"}
          </button>
          <button className="btn primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
