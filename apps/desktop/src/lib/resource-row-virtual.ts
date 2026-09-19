import type { CSSProperties } from "react";

/**
 * Absolutely positioned virtual-list item. Height must come from content +
 * `measureElement`. Locking `height` to the estimate makes wrapped copy overlap
 * the next row.
 */
export function resourceRowVirtualStyle(
  start: number,
  scrollMargin = 0,
): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${start - scrollMargin}px)`,
  };
}
