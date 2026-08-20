import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createLibraryPlugin,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import { ButtonSpinner } from "./ButtonSpinner";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface PinToPluginPanelProps {
  open: boolean;
  mode: "pin" | "attach";
  heads: LibraryPluginHead[];
  excludeName?: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  confirming?: boolean;
  onClose: () => void;
  onConfirm: (pluginName: string) => void | Promise<void>;
  onCreated?: (plugin: LibraryPluginHead) => void;
}

export function PinToPluginPanel({
  open,
  mode,
  heads,
  excludeName,
  baseUrl,
  token,
  disabled = false,
  confirming = false,
  onClose,
  onConfirm,
  onCreated,
}: PinToPluginPanelProps) {
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createdHeads, setCreatedHeads] = useState<LibraryPluginHead[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setSelectedName(null);
    setCreateName("");
    setCreateError(null);
    setCreateBusy(false);
    setCreatedHeads([]);
  }, [open]);

  const authored = useMemo(() => {
    const merged = new Map<string, LibraryPluginHead>();
    for (const head of [...heads, ...createdHeads]) {
      if (head.origin === "authored" && head.name !== excludeName) {
        merged.set(head.name, head);
      }
    }
    return [...merged.values()];
  }, [createdHeads, excludeName, heads]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return authored;
    }
    return authored.filter((head) => head.name.toLowerCase().includes(needle));
  }, [authored, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (confirming || createBusy) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming, createBusy, onClose, open]);

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || confirming || createBusy || !baseUrl;
  const title = mode === "attach" ? "Attach to plugin" : "Pin to plugin";
  const confirmLabel = mode === "attach" ? "Attach" : "Pin";
  const showCreate = authored.length === 0;

  const onCreate = async () => {
    const name = createName.trim();
    if (!baseUrl || !name || createBusy) {
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const plugin = await createLibraryPlugin(baseUrl, token, { name });
      setCreatedHeads((current) => [...current, plugin]);
      setSelectedName(plugin.name);
      setCreateName("");
      onCreated?.(plugin);
    } catch (createErr: unknown) {
      setCreateError(errorMessage(createErr, "Could not create plugin."));
    } finally {
      setCreateBusy(false);
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
        aria-labelledby="pin-to-plugin-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Sources</div>
            <h2 id="pin-to-plugin-title">{title}</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close pin to plugin drawer"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body">
          {showCreate ? (
            <div className="form-field gap-1.5">
              <Label htmlFor="pin-to-plugin-create-name">Create plugin</Label>
              <Input
                id="pin-to-plugin-create-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="my-plugin"
                disabled={controlsDisabled}
                autoFocus
              />
              {createError ? (
                <div className="banner error" role="alert">
                  {createError}
                </div>
              ) : null}
              <button
                className={["btn", "primary", createBusy ? "is-busy" : ""]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={() => void onCreate()}
                disabled={!createName.trim() || controlsDisabled}
                aria-busy={createBusy}
              >
                {createBusy ? <ButtonSpinner size={16} /> : null}
                {createBusy ? "Creating…" : "Create plugin"}
              </button>
            </div>
          ) : (
            <>
              <div className="form-field gap-1.5">
                <Label htmlFor="pin-to-plugin-search">Search plugins</Label>
                <Input
                  id="pin-to-plugin-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter authored plugins"
                  disabled={controlsDisabled}
                  autoFocus
                />
              </div>
              {filtered.length === 0 ? (
                <p className="muted">No matching authored plugins.</p>
              ) : (
                <ul className="sources-pin-plugin-list">
                  {filtered.map((head) => (
                    <li key={head.id}>
                      <label
                        className={`resource-filter-option${
                          selectedName === head.name ? " selected" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name="pin-to-plugin-target"
                          checked={selectedName === head.name}
                          disabled={controlsDisabled}
                          onChange={() => setSelectedName(head.name)}
                        />
                        <span>{head.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {selectedName && showCreate ? (
            <p className="muted">Selected {selectedName}.</p>
          ) : null}
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
            className={["btn", "primary", confirming ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={() => {
              if (!selectedName) {
                return;
              }
              void onConfirm(selectedName);
            }}
            disabled={!selectedName || controlsDisabled}
            aria-busy={confirming}
          >
            {confirming ? <ButtonSpinner size={16} /> : null}
            {confirming ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}