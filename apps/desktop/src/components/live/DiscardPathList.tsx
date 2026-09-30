import { useState } from "react";
import {
  DISCARD_PATHS_PAGE_SIZE,
  formatDiscardFileCount,
  sliceDiscardPaths,
  type DiscardPathRow,
} from "../../lib/scope-inventory-discard";

export function DiscardPathList({
  rows,
  showLabels,
}: {
  rows: readonly DiscardPathRow[];
  showLabels: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(DISCARD_PATHS_PAGE_SIZE);
  if (rows.length === 0) {
    return null;
  }

  const visible = sliceDiscardPaths(rows, visibleCount);
  const canRevealMore = visible.length < rows.length;

  return (
    <div className="confirm-discard-paths">
      <p className="muted">{formatDiscardFileCount(rows.length)}</p>
      <ul className="confirm-discard-paths-list">
        {visible.map((row) => (
          <li key={row.key} className="confirm-discard-path-row">
            {showLabels ? (
              <span className="confirm-discard-path-label">{row.label}</span>
            ) : null}
            <span className="confirm-discard-path mono">{row.path}</span>
          </li>
        ))}
      </ul>
      {canRevealMore ? (
        <div className="confirm-discard-more">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setVisibleCount((current) =>
                Math.min(current + DISCARD_PATHS_PAGE_SIZE, rows.length),
              );
            }}
          >
            Show more
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setVisibleCount(rows.length);
            }}
          >
            Show all
          </button>
        </div>
      ) : null}
    </div>
  );
}
