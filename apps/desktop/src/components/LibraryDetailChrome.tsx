import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export interface LibraryDetailChromeProps {
  titleId: string;
  title: ReactNode;
  typeLabel: string;
  onBack: () => void;
  backDisabled?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

export function LibraryDetailChrome({
  titleId,
  title,
  typeLabel,
  onBack,
  backDisabled = false,
  actions,
  children,
}: LibraryDetailChromeProps) {
  return (
    <div className="library-detail">
      <div className="library-detail-header">
        <button
          type="button"
          className="icon-action"
          aria-label="Back to library list"
          title="Back to library list"
          onClick={onBack}
          disabled={backDisabled}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
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
