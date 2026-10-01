import type { CSSProperties } from "react";

/**
 * Offset of `list` from the start of `scroll`'s content. Independent of the
 * current scrollTop; do not recompute this on scroll or the virtualizer and
 * React fight over item `translateY`.
 */
export function listScrollMargin(
  list: { getBoundingClientRect: () => { top: number } },
  scroll: { getBoundingClientRect: () => { top: number }; scrollTop: number },
): number {
  return (
    list.getBoundingClientRect().top
    - scroll.getBoundingClientRect().top
    + scroll.scrollTop
  );
}

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
