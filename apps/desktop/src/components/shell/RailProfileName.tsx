import { useEffect, useState } from "react";
import { ChromeTooltip } from "../ChromeTooltip";

/** True while the element's text is cut by its own width (ellipsis showing). */
export function useIsTruncated(element: HTMLElement | null): boolean {
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!element) {
      return;
    }
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return truncated;
}

/**
 * Profile name in the Profiles rail. It takes the row's free width and
 * ellipsizes only on real overflow; a cut name shows in full in a tooltip.
 */
export function RailProfileName({ name }: { name: string }) {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const truncated = useIsTruncated(element);
  const label = (
    <span
      ref={setElement}
      className="profile-item-name"
      data-testid={`profile-rail-name-${name}`}
      data-truncated={truncated ? "true" : undefined}
    >
      {name}
    </span>
  );
  return truncated ? (
    <ChromeTooltip content={name} side="right">
      {label}
    </ChromeTooltip>
  ) : (
    label
  );
}
