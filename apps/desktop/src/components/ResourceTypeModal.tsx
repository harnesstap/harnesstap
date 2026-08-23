import { useEffect, useId, useRef } from "react";
import {
  Bot,
  BookOpen,
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
import {
  CREATE_RESOURCE_TYPES,
  getResourceCreateSchema,
  type CreateResourceType,
} from "../lib/resource-create-schema";

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
  onClose: () => void;
  onSelect: (type: CreateResourceType) => void;
}

export function ResourceTypeModal({
  open,
  disabled = false,
  onClose,
  onSelect,
}: ResourceTypeModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
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
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
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
          <h2 id={titleId}>What do you want to create?</h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-action"
            aria-label="Close type picker"
            title="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
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
      </div>
    </div>
  );
}
