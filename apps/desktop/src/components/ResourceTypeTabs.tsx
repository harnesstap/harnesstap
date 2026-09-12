import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import {
  ALL_RESOURCE_TYPE_TAB,
  resolveResourceTypeTab,
  RESOURCE_TYPE_TABS_WIDE_MIN_PX,
  resourceTypeTabGlyph,
  resourceTypeTabItemCount,
  resourceTypeTabLabel,
  resourceTypeTabShowsCompactBadge,
  resourceTypeTabShowsCount,
  resourceTypeTabText,
  resourceTypeTabTooltip,
  visibleResourceTypeTabs,
  type ResourceTypeTabDensity,
} from "../lib/resource-type-tabs";
import { ChromeTooltip } from "./ChromeTooltip";
import { TypeIcon } from "./TypeIcon";

export interface ResourceTypeTabsProps {
  counts: ReadonlyMap<string, number>;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** Profile resources omits All; Library / Not staged / compose keep it. */
  includeAll?: boolean;
  /**
   * `labeled` (Library, Not staged, compose, Global/Project type filters):
   * always icon, count, type text; wrap; never icon-only.
   * `compact` (Profile resources): may collapse to icon-only with a count badge.
   */
  density?: ResourceTypeTabDensity;
}

function TabGlyph({ type }: { type: string }): ReactNode {
  if (resourceTypeTabGlyph(type) === "layout-grid") {
    return <LayoutGrid size={14} aria-hidden />;
  }
  return <TypeIcon type={type} />;
}

function hostPaneWidth(el: HTMLElement): number {
  const host = el.parentElement ?? el;
  return Math.max(el.getBoundingClientRect().width, host.getBoundingClientRect().width);
}

export function ResourceTypeTabs({
  counts,
  value,
  onChange,
  disabled = false,
  includeAll = true,
  density = "labeled",
}: ResourceTypeTabsProps): ReactNode {
  const labelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const labeled = density === "labeled";
  const [compact, setCompact] = useState(!labeled);
  const tabOptions = { includeAll };
  const tabs = visibleResourceTypeTabs(counts, tabOptions);
  const resolved = resolveResourceTypeTab(value, counts, tabOptions);
  const toggleValue =
    resolved
    ?? (includeAll && tabs.includes(ALL_RESOURCE_TYPE_TAB)
      ? ALL_RESOURCE_TYPE_TAB
      : (tabs[0] ?? ALL_RESOURCE_TYPE_TAB));

  useEffect(() => {
    if (labeled) {
      setCompact(false);
      return;
    }
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const host = el.parentElement ?? el;
    const update = (): void => {
      setCompact(hostPaneWidth(el) < RESOURCE_TYPE_TABS_WIDE_MIN_PX);
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (host !== el) {
      observer.observe(host);
    }
    update();
    return () => observer.disconnect();
  }, [labeled]);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="resource-type-tabs"
      data-density={density}
      data-compact={compact ? "true" : "false"}
    >
      <span className="sr-only" id={labelId}>
        Resource type
      </span>
      <ToggleGroup.Root
        className="resource-type-tabs-scroller"
        type="single"
        value={toggleValue}
        disabled={disabled}
        aria-labelledby={labelId}
        onValueChange={(next) => {
          if (!next) {
            return;
          }
          if (next === ALL_RESOURCE_TYPE_TAB) {
            onChange(includeAll ? null : (tabs[0] ?? null));
            return;
          }
          onChange(next);
        }}
      >
        {tabs.map((type) => {
          const label = resourceTypeTabLabel(type);
          const count = resourceTypeTabItemCount(type, counts);
          const caption = labeled || compact
            ? resourceTypeTabTooltip(type, counts)
            : resourceTypeTabText(type, counts);
          const showCount = labeled || resourceTypeTabShowsCount(counts);
          const showBadge = !labeled && resourceTypeTabShowsCompactBadge(count);
          const glyph = <TabGlyph type={type} />;
          const face = (
            <span className="resource-type-tab-face">
              {glyph}
              {showBadge ? (
                <span
                  className="resource-type-tab-badge"
                  data-testid={`resource-type-tab-badge-${type}`}
                >
                  {count}
                </span>
              ) : null}
            </span>
          );
          return (
            <ToggleGroup.Item
              key={type}
              value={type}
              className="resource-type-tab"
              data-testid={`resource-type-tab-${type}`}
              aria-label={caption}
              disabled={disabled}
            >
              {compact ? (
                <ChromeTooltip content={caption}>{face}</ChromeTooltip>
              ) : (
                face
              )}
              {labeled ? (
                <>
                  <span className="resource-type-tab-count">{count}</span>
                  <span className="resource-type-tab-label">{label}</span>
                </>
              ) : (
                <>
                  <span className="resource-type-tab-label">{label}</span>
                  {showCount ? (
                    <span className="resource-type-tab-count">{count}</span>
                  ) : null}
                </>
              )}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
    </div>
  );
}
