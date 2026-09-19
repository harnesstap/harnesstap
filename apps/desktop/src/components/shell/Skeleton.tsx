import type { CSSProperties } from "react";

export interface SkeletonProps {
  lines?: number;
}

export interface SkeletonRowProps {
  count?: number;
  height?: number;
}

/** First-load placeholder lines. Shimmer via `.m-skeleton`. */
export function Skeleton({ lines = 3 }: SkeletonProps) {
  const items = Array.from({ length: Math.max(0, lines) }, (_, index) => index);
  return (
    <div className="skeleton-block">
      <div aria-hidden="true">
        {items.map((index) => (
          <div key={index} className="skeleton-line m-skeleton" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** First-load placeholder rows (inventory, library, environments). */
export function SkeletonRow({ count = 8, height = 40 }: SkeletonRowProps) {
  const items = Array.from({ length: Math.max(0, count) }, (_, index) => index);
  const style: CSSProperties = { height };
  return (
    <div className="skeleton-rows">
      <div aria-hidden="true">
        {items.map((index) => (
          <div key={index} className="skeleton-row m-skeleton" style={style} />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
