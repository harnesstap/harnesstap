import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createLibraryPlugin,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import { Pin, Plus, X } from "lucide-react";
import { ButtonSpinner } from "./ButtonSpinner";
import { FullScreenPanel } from "./FullScreenPanel";

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
  error?: string | null;
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
  error = null,
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

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || confirming || createBusy || !baseUrl;
  const title = "Pin to plugin";
  let confirmLabel: string;
  let bodyHint: string;
  switch (mode) {
    case "attach":
      confirmLabel = "Attach";
      bodyHint = "Attach this resource into one of your plugins.";
      break;
    case "pin":
      confirmLabel = "Pin";
      bodyHint = "Link into an authored plugin.";
      break;
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }

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
    <FullScreenPanel
      titleId="pin-to-plugin-title"
      title={title}
      eyebrow="Discover"
      subtitle={bodyHint}
      closeLabel="Close pin to plugin"
      closeDisabled={controlsDisabled}
      onClose={onClose}
      testId="pin-to-plugin-panel"
      actions={
        <>
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            <X size={16} aria-hidden />
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
            {confirming ? <ButtonSpinner size={16} /> : <Pin size={16} aria-hidden />}
            {confirming ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {authored.length > 0 ? (
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
      ) : (
        <p className="muted">No authored plugins yet. Create one below.</p>
      )}
      <div className="form-field gap-1.5 sources-pin-create">
        <Label htmlFor="pin-to-plugin-create-name">Create plugin</Label>
        <Input
          id="pin-to-plugin-create-name"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          placeholder="my-plugin"
          disabled={controlsDisabled}
          autoFocus={authored.length === 0}
        />
        {createError ? (
          <div className="banner error" role="alert">
            {createError}
          </div>
        ) : null}
        <button
          className={["btn", createBusy ? "is-busy" : ""]
            .filter(Boolean)
            .join(" ")}
          type="button"
          data-testid="pin-create-plugin"
          onClick={() => void onCreate()}
          disabled={!createName.trim() || controlsDisabled}
          aria-busy={createBusy}
        >
          {createBusy ? <ButtonSpinner size={16} /> : <Plus size={16} aria-hidden />}
          {createBusy ? "Creating…" : "Create plugin"}
        </button>
      </div>
      {selectedName ? (
        <p className="muted">Selected {selectedName}.</p>
      ) : null}
    </FullScreenPanel>
  );
}
