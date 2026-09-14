import { useId, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import {
  ALL_RESOURCE_TYPE_TAB,
  resolveResourceTypeTab,
  resourceTypeTabEmptyDisabled,
  resourceTypeTabGlyph,
  resourceTypeTabItemCount,
  resourceTypeTabLabel,
  resourceTypeTabTooltip,
  visibleResourceTypeTabs,
  type ResourceTypeTabEmptyMode,
  type TypeTabAttention,
  typeTabAttentionTooltip,
} from "../lib/resource-type-tabs";
import { ChromeTooltip } from "./ChromeTooltip";
import { TypeIcon } from "./TypeIcon";

export type ResourceTypeTabDensity = "default" | "wide" | "compact";

export interface ResourceTypeTabsProps {
  counts: ReadonlyMap<string, number>;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** Profile resources omits All; Library / Not staged / compose keep it. */
  includeAll?: boolean;
  emptyMode?: ResourceTypeTabEmptyMode;
  /** Inventory wide pills. Prefer `density`. */
  wide?: boolean;
  /** `compact` is Add to profile modal only (single row, icon+count). */
  density?: ResourceTypeTabDensity;
  /** Not in profile / Inactive attention. Do not pass disk-diff. */
  attention?: ReadonlyMap<string, TypeTabAttention>;
}

function TabGlyph({ type }: { type: string }): ReactNode {
  if (resourceTypeTabGlyph(type) === "layout-grid") {
    return <LayoutGrid size={14} aria-hidden />;
  }
  return <TypeIcon type={type} />;
}

function resolveTabDensity(
  density: ResourceTypeTabDensity | undefined,
  wide: boolean,
): ResourceTypeTabDensity {
  if (density) {
    return density;
  }
  return wide ? "wide" : "default";
}

function densityClassName(density: ResourceTypeTabDensity): string {
  switch (density) {
    case "default":
      return "";
    case "wide":
      return "resource-type-tabs-wide";
    case "compact":
      return "resource-type-tabs-compact";
    default: {
      const neverDensity: never = density;
      return neverDensity;
    }
  }
}

export function ResourceTypeTabs({
  counts,
  value,
  onChange,
  disabled = false,
  includeAll = true,
  emptyMode = "hide",
  wide = false,
  density,
  attention,
}: ResourceTypeTabsProps): ReactNode {
  const labelId = useId();
  const tabOptions = { includeAll, emptyMode };
  const tabs = visibleResourceTypeTabs(counts, tabOptions);
  const resolved = resolveResourceTypeTab(value, counts, tabOptions);
  const resolvedDensity = resolveTabDensity(density, wide);
  const toggleValue =
    resolved
    ?? (includeAll && tabs.includes(ALL_RESOURCE_TYPE_TAB)
      ? ALL_RESOURCE_TYPE_TAB
      : (tabs[0] ?? ALL_RESOURCE_TYPE_TAB));

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className={["resource-type-tabs", densityClassName(resolvedDensity)]
        .filter(Boolean)
        .join(" ")}
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
          const caption = resourceTypeTabTooltip(type, counts, tabOptions);
          const empty = resourceTypeTabEmptyDisabled(type, counts);
          const itemDisabled = empty;
          const review = empty ? null : typeTabAttentionTooltip(attention?.get(type));
          const ariaLabel = review ? `${caption}. ${review}` : caption;
          const compact = resolvedDensity === "compact";
          const face = (
            <>
              <span className="resource-type-tab-face">
                <TabGlyph type={type} />
                {review ? (
                  <span className="resource-type-tab-attention" aria-hidden />
                ) : null}
              </span>
              <span className="resource-type-tab-count">{count}</span>
              <span className="resource-type-tab-label">{label}</span>
            </>
          );
          const tooltip = compact
            ? ariaLabel
            : review ?? (empty ? caption : null);
          const inner = tooltip ? (
            <ChromeTooltip content={tooltip} side="top">
              <span
                className={
                  empty
                    ? "resource-type-tab-disabled-host"
                    : "resource-type-tab-host"
                }
              >
                {face}
              </span>
            </ChromeTooltip>
          ) : (
            face
          );
          return (
            <ToggleGroup.Item
              key={type}
              value={type}
              className="resource-type-tab"
              data-testid={`resource-type-tab-${type}`}
              aria-label={ariaLabel}
              disabled={itemDisabled}
            >
              {inner}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
    </div>
  );
}
