import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import {
  ALL_RESOURCE_TYPE_TAB,
  resolveResourceTypeTab,
  resourceTypeTabLabel,
  visibleResourceTypeTabs,
} from "../lib/resource-type-tabs";
import { ChromeTooltip } from "./ChromeTooltip";
import { TypeIcon } from "./TypeIcon";

const LABEL_MIN_WIDTH_PX = 900;

export interface ResourceTypeTabsProps {
  counts: ReadonlyMap<string, number>;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

function TabGlyph({ type }: { type: string }): ReactNode {
  if (type === ALL_RESOURCE_TYPE_TAB) {
    return <LayoutGrid size={14} aria-hidden />;
  }
  return <TypeIcon type={type} />;
}

export function ResourceTypeTabs({
  counts,
  value,
  onChange,
  disabled = false,
}: ResourceTypeTabsProps): ReactNode {
  const labelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(true);
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
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setCompact(width < LABEL_MIN_WIDTH_PX);
    });
    observer.observe(el);
    setCompact(el.clientWidth < LABEL_MIN_WIDTH_PX);
    return () => observer.disconnect();
  }, []);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className="resource-type-tabs">
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
          const glyph = <TabGlyph type={type} />;
          return (
            <ToggleGroup.Item
              key={type}
              value={type}
              className="resource-type-tab"
              data-testid={`resource-type-tab-${type}`}
              aria-label={label}
              disabled={disabled}
            >
              {compact ? (
                <ChromeTooltip content={label}>
                  <span className="resource-type-tab-face">{glyph}</span>
                </ChromeTooltip>
              ) : (
                <>
                  {glyph}
                  <span className="resource-type-tab-label">{label}</span>
                </>
              )}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
    </div>
  );
}
