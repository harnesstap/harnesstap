import type { HTMLAttributes, ReactNode } from "react";
import { joinClassNames, prefersReducedMotion } from "./motion-utils";

export interface CollapseProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  open: boolean;
  /** Skip the height/opacity transition (large lists, reduced motion is automatic). */
  skipAnimation?: boolean;
  children: ReactNode;
}

/**
 * Expands and collapses its children by animating `grid-template-rows`
 * (0fr → 1fr) plus opacity, so no measuring is needed. The inner wrapper has
 * `min-height: 0; overflow: hidden` so content clips instead of overflowing.
 */
export function Collapse({
  open,
  skipAnimation = false,
  children,
  className,
  ...rest
}: CollapseProps) {
  const instant = skipAnimation || prefersReducedMotion();
  return (
    <div
      {...rest}
      className={joinClassNames("m-collapse", className)}
      data-state={open ? "open" : "closed"}
      data-instant={instant ? "" : undefined}
      aria-hidden={open ? undefined : true}
    >
      <div className="m-collapse-inner">{children}</div>
    </div>
  );
}
