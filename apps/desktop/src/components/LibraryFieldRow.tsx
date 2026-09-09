import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";

export interface LibraryFieldRowProps {
  icon: ReactNode;
  fieldName: string;
  readOnly: boolean;
  display?: ReactNode;
  placeholder?: string;
  editing: boolean;
  onStartEdit: () => void;
  error?: string | null;
  mono?: boolean;
  action?: ReactNode;
  iconButtonLabel?: string;
  onIconClick?: () => void;
  children?: ReactNode;
}

export function LibraryFieldRow({
  icon,
  fieldName,
  readOnly,
  display,
  placeholder,
  editing,
  onStartEdit,
  error,
  mono = false,
  action,
  iconButtonLabel,
  onIconClick,
  children,
}: LibraryFieldRowProps) {
  const showPlaceholder = display == null || display === "";
  const iconLabel = iconButtonLabel ?? fieldName;

  return (
    <div className="library-field-row">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {onIconClick ? (
            <button
              type="button"
              className="library-field-icon is-button"
              aria-label={iconLabel}
              onClick={onIconClick}
            >
              {icon}
            </button>
          ) : (
            <span
              className="library-field-icon"
              tabIndex={0}
              aria-label={fieldName}
            >
              {icon}
            </span>
          )}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="library-field-tooltip"
            side="top"
            sideOffset={4}
          >
            {fieldName}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <div
        className={["library-field-value", mono ? "mono" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="library-field-name">{fieldName}</div>
        {editing ? (
          children
        ) : (
          <div
            className={
              readOnly
                ? "library-field-display"
                : "library-field-display is-editable"
            }
            onDoubleClick={() => {
              if (!readOnly) {
                onStartEdit();
              }
            }}
          >
            {showPlaceholder ? (
              <span className="muted">{placeholder}</span>
            ) : (
              display
            )}
          </div>
        )}
        {error ? <p className="library-field-error">{error}</p> : null}
      </div>
      {action ? <div className="library-field-action">{action}</div> : null}
    </div>
  );
}
