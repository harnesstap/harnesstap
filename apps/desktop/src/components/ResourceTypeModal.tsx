import { useEffect, useId, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  FolderDown,
  KeyRound,
  Package,
  Plug,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importLibraryPluginFromGit } from "../lib/api/library-plugins";
import { AgentApiError } from "../lib/api/http";
import {
  CREATE_RESOURCE_TYPES,
  getResourceCreateSchema,
  type CreateResourceType,
} from "../lib/resource-create-schema";
import { ButtonSpinner } from "./ButtonSpinner";
import { IconActionButton } from "./IconActionButton";

const TYPE_ICONS: Record<CreateResourceType, LucideIcon> = {
  plugin: Package,
  instruction: BookOpen,
  skill: Sparkles,
  rule: ScrollText,
  mcp_server: Plug,
  permission: ShieldCheck,
  hook: Webhook,
  agent: Bot,
  command: SquareTerminal,
  env_var: KeyRound,
  model_config: SlidersHorizontal,
};

export interface ResourceTypeModalProps {
  open: boolean;
  disabled?: boolean;
  baseUrl?: string | null;
  token?: string | null;
  onClose: () => void;
  onSelect: (type: CreateResourceType) => void;
  onImported?: (pluginName: string) => void;
}

function importErrorMessage(error: unknown): string {
  if (error instanceof AgentApiError && error.message) {
    return error.message;
  }
  return error instanceof Error && error.message
    ? error.message
    : "Could not import plugin";
}

export function ResourceTypeModal({
  open,
  disabled = false,
  baseUrl = null,
  token = null,
  onClose,
  onSelect,
  onImported,
}: ResourceTypeModalProps) {
  const titleId = useId();
  const sourceId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"pick" | "import">("pick");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      return;
    }
    setMode("pick");
    setSource("");
    setBusy(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (busy) {
        return;
      }
      if (mode === "import") {
        setMode("pick");
        setError(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, mode, busy]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (mode === "import") {
        document.getElementById(sourceId)?.focus();
        return;
      }
      closeRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, mode, sourceId]);

  if (!open) {
    return null;
  }

  const leave = () => {
    if (busy) {
      return;
    }
    onClose();
  };

  const submitImport = async () => {
    if (!baseUrl || disabled || busy) {
      return;
    }
    const trimmed = source.trim();
    if (!trimmed) {
      setError("Paste a GitHub URL or owner/repo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const imported = await importLibraryPluginFromGit(baseUrl, token, trimmed);
      onImported?.(imported.plugin.name);
      onClose();
    } catch (caught) {
      setError(importErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          leave();
        }
      }}
    >
      <div
        className="dialog resource-type-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="resource-type-modal"
      >
        <div className="resource-type-header">
          <h2 id={titleId}>
            {mode === "import" ? "Import from GitHub" : "What do you want to create?"}
          </h2>
          <div className="resource-type-header-actions">
            {mode === "pick" ? (
              <IconActionButton
                primary
                showLabel
                data-testid="resource-type-import"
                label="Import"
                disabled={disabled || busy || !baseUrl}
                onClick={() => {
                  setMode("import");
                  setError(null);
                }}
                icon={<FolderDown size={16} aria-hidden />}
              />
            ) : null}
            <button
              ref={closeRef}
              type="button"
              className="icon-action"
              aria-label={mode === "import" ? "Close import" : "Close type picker"}
              title="Close"
              disabled={busy}
              onClick={leave}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </div>
        {mode === "import" ? (
          <form
            className="resource-type-import"
            onSubmit={(event) => {
              event.preventDefault();
              void submitImport();
            }}
          >
            <Label htmlFor={sourceId}>GitHub repository</Label>
            <Input
              id={sourceId}
              data-testid="resource-type-import-source"
              placeholder="https://github.com/owner/repo"
              value={source}
              disabled={disabled || busy}
              autoComplete="off"
              onChange={(event) => {
                setSource(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
            />
            <p className="muted resource-type-import-hint">
              Accepts https://github.com/owner/repo, owner/repo, or gh:owner/repo.
              The repo must have a root plugin.json.
            </p>
            {error ? (
              <p className="resource-type-import-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode("pick");
                  setError(null);
                }}
              >
                Back
              </button>
              <button
                className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
                type="submit"
                data-testid="resource-type-import-submit"
                disabled={disabled || busy || !baseUrl}
                aria-busy={busy}
              >
                {busy ? <ButtonSpinner size={16} /> : <FolderDown size={16} aria-hidden />}
                Import
              </button>
            </div>
          </form>
        ) : (
          <ul className="resource-type-list">
            {CREATE_RESOURCE_TYPES.map((type) => {
              const schema = getResourceCreateSchema(type);
              const Icon = TYPE_ICONS[type];
              return (
                <li key={type}>
                  <button
                    type="button"
                    className="resource-type-option"
                    data-testid={`resource-type-option-${type}`}
                    disabled={disabled}
                    onClick={() => onSelect(type)}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="resource-type-copy">
                      <span className="resource-type-title">{schema.title}</span>
                      <span className="resource-type-description muted">
                        {schema.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
