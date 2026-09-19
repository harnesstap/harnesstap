import type { ReactNode } from "react";

export interface DiscoverDetailChromeProps {
  titleId: string;
  title: ReactNode;
  typeLabel: string;
  children?: ReactNode;
}

/** Nested Discover chrome without a second Back (workspace header owns Back). */
export function DiscoverDetailChrome({
  titleId,
  title,
  typeLabel,
  children,
}: DiscoverDetailChromeProps) {
  return (
    <div className="library-detail">
      <div className="library-detail-header">
        <div id={titleId} className="library-detail-title">
          {title}
        </div>
        {typeLabel ? (
          <span className="muted library-detail-type">{typeLabel}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
