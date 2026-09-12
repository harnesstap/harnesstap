import { useId, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import {
  ALL_RESOURCE_TYPE_TAB,
  resolveResourceTypeTab,
  resourceTypeTabGlyph,
  resourceTypeTabItemCount,
  resourceTypeTabLabel,
  resourceTypeTabTooltip,
  visibleResourceTypeTabs,
} from "../lib/resource-type-tabs";
import { TypeIcon } from "./TypeIcon";

export interface ResourceTypeTabsProps {
  counts: ReadonlyMap<string, number>;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** Profile resources omits All; Library / Not staged / compose keep it. */
  includeAll?: boolean;
}

function TabGlyph({ type }: { type: string }): ReactNode {
  if (resourceTypeTabGlyph(type) === "layout-grid") {
    return <LayoutGrid size={14} aria-hidden />;
  }
  return <TypeIcon type={type} />;
}

export function ResourceTypeTabs({
  counts,
  value,
  onChange,
  disabled = false,
  includeAll = true,
}: ResourceTypeTabsProps): ReactNode {
  const labelId = useId();
  const tabOptions = { includeAll };
  const tabs = visibleResourceTypeTabs(counts, tabOptions);
  const resolved = resolveResourceTypeTab(value, counts, tabOptions);
  const toggleValue =
    resolved
    ?? (includeAll && tabs.includes(ALL_RESOURCE_TYPE_TAB)
      ? ALL_RESOURCE_TYPE_TAB
      : (tabs[0] ?? ALL_RESOURCE_TYPE_TAB));

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="resource-type-tabs">
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
          const caption = resourceTypeTabTooltip(type, counts);
          return (
            <ToggleGroup.Item
              key={type}
              value={type}
              className="resource-type-tab"
              data-testid={`resource-type-tab-${type}`}
              aria-label={caption}
              disabled={disabled}
            >
              <span className="resource-type-tab-face">
                <TabGlyph type={type} />
              </span>
              <span className="resource-type-tab-count">{count}</span>
              <span className="resource-type-tab-label">{label}</span>
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
    </div>
  );
}
