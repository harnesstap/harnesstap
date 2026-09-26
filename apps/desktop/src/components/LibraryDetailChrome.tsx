import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { IconActionButton } from "./IconActionButton";

export interface LibraryDetailChromeProps {
  titleId: string;
  title: ReactNode;
  /** Optional type word beside the title. Resource details omit this. */
  typeLabel?: string;
  onBack: () => void;
  onBackPointerDown?: () => void;
  preserveFocusOnBack?: boolean;
  backDisabled?: boolean;
  backLabel?: string;
  /** Workspace hosts pass false so the shell Back is the only one. Default true. */
  showBack?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

export function LibraryDetailChrome({
  titleId,
  title,
  typeLabel,
  onBack,
  onBackPointerDown,
  preserveFocusOnBack = false,
  backDisabled = false,
  backLabel = "Back to library list",
  showBack = true,
  actions,
  children,
}: LibraryDetailChromeProps) {
  return (
    <div className="library-detail">
      <div className="library-detail-header">
        {showBack ? (
          <IconActionButton
            label={backLabel}
            onPointerDown={(event) => {
              if (preserveFocusOnBack) {
                event.preventDefault();
              }
              onBackPointerDown?.();
            }}
            onClick={onBack}
            disabled={backDisabled}
            icon={<ArrowLeft size={16} aria-hidden />}
          />
        ) : null}
        <div id={titleId} className="library-detail-title">
          {title}
        </div>
        {typeLabel ? (
          <span className="muted library-detail-type">{typeLabel}</span>
        ) : null}
        {actions ? (
          <div className="library-detail-actions">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
