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
  resourceTypeTabShowsCount,
  resourceTypeTabText,
  visibleResourceTypeTabs,
} from "../lib/resource-type-tabs";
import { ChromeTooltip } from "./ChromeTooltip";
import { TypeIcon } from "./TypeIcon";

export interface ResourceTypeTabsProps {
  counts: ReadonlyMap<string, number>;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
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
}: ResourceTypeTabsProps): ReactNode {
  const labelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const tabs = visibleResourceTypeTabs(counts);
  const resolved = resolveResourceTypeTab(value, counts);
  const toggleValue =
    resolved
    ?? (tabs.includes(ALL_RESOURCE_TYPE_TAB) ? ALL_RESOURCE_TYPE_TAB : (tabs[0] ?? ALL_RESOURCE_TYPE_TAB));

  useEffect(() => {
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
  }, []);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="resource-type-tabs"
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
          onChange(next === ALL_RESOURCE_TYPE_TAB ? null : next);
        }}
      >
        {tabs.map((type) => {
          const label = resourceTypeTabLabel(type);
          const caption = resourceTypeTabText(type, counts);
          const showCount = resourceTypeTabShowsCount(counts);
          const count = resourceTypeTabItemCount(type, counts);
          const glyph = <TabGlyph type={type} />;
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
                <ChromeTooltip content={caption}>
                  <span className="resource-type-tab-face">{glyph}</span>
                </ChromeTooltip>
              ) : (
                glyph
              )}
              <span className="resource-type-tab-label">{label}</span>
              {showCount ? (
                <span className="resource-type-tab-count">{count}</span>
              ) : null}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
    </div>
  );
}
