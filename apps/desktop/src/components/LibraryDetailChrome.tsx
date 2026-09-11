import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { IconActionButton } from "./IconActionButton";

export interface LibraryDetailChromeProps {
  titleId: string;
  title: ReactNode;
  typeLabel: string;
  onBack: () => void;
  onBackPointerDown?: () => void;
  preserveFocusOnBack?: boolean;
  backDisabled?: boolean;
  backLabel?: string;
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
  actions,
  children,
}: LibraryDetailChromeProps) {
  return (
    <div className="library-detail">
      <div className="library-detail-header">
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
