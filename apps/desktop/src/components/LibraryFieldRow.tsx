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
  children,
}: LibraryFieldRowProps) {
  const showPlaceholder = display == null || display === "";

  return (
    <div className="library-field-row">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            className="library-field-icon"
            tabIndex={0}
            aria-label={fieldName}
          >
            {icon}
          </span>
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
    </div>
  );
}
