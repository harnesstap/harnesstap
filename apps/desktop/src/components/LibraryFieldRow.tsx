import type { KeyboardEvent, ReactNode } from "react";
import { Pencil } from "lucide-react";
import { ChromeTooltip } from "./ChromeTooltip";
import { IconActionButton } from "./IconActionButton";

export interface LibraryFieldRowProps {
  icon: ReactNode;
  fieldName: string;
  readOnly: boolean;
  display?: ReactNode;
  placeholder?: string;
  editing: boolean;
  onStartEdit: () => void;
  onCommit?: () => void;
  onCancel?: () => void;
  error?: string | null;
  mono?: boolean;
  action?: ReactNode;
  iconButtonLabel?: string;
  onIconClick?: () => void;
  /** Explicit Save/Cancel under the editor; blur does not commit. */
  multiline?: boolean;
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
  onCommit,
  onCancel,
  error,
  mono = false,
  action,
  iconButtonLabel,
  onIconClick,
  multiline = false,
  children,
}: LibraryFieldRowProps) {
  const showPlaceholder = display == null || display === "";
  const iconLabel = iconButtonLabel ?? fieldName;

  function handleDisplayKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (readOnly || editing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onStartEdit();
    }
  }

  return (
    <div className="library-field-row">
      <ChromeTooltip content={fieldName} side="top">
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
          <span className="library-field-icon" role="img" aria-label={fieldName}>
            {icon}
          </span>
        )}
      </ChromeTooltip>
      <div
        className={["library-field-value", mono ? "mono" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="library-field-name">{fieldName}</div>
        {editing ? (
          <>
            {children}
            {multiline ? (
              <div className="library-field-edit-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={onCommit}
                >
                  Save
                </button>
                <button type="button" className="btn" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div
            className={
              readOnly
                ? "library-field-display"
                : "library-field-display is-editable"
            }
            tabIndex={readOnly ? undefined : 0}
            onClick={() => {
              if (!readOnly) {
                onStartEdit();
              }
            }}
            onKeyDown={handleDisplayKeyDown}
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
            {readOnly ? null : (
              <IconActionButton
                className="library-field-edit-trigger"
                label="Edit"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onStartEdit();
                }}
                icon={<Pencil size={14} aria-hidden />}
              />
            )}
          </div>
        )}
        {error ? <p className="library-field-error">{error}</p> : null}
      </div>
      {action ? <div className="library-field-action">{action}</div> : null}
    </div>
  );
}
