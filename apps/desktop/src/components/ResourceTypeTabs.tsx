import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LayoutGrid } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import {
  ALL_RESOURCE_TYPE_TAB,
  collapsedTypeTabFit,
  resolveResourceTypeTab,
  resourceTypeTabEmptyDisabled,
  resourceTypeTabGlyph,
  resourceTypeTabItemCount,
  resourceTypeTabLabel,
  resourceTypeTabTooltip,
  TYPE_TABS_LESS_LABEL,
  typeTabsMoreLabel,
  visibleResourceTypeTabs,
  type ResourceTypeTabEmptyMode,
  type TypeTabAttention,
  typeTabAttentionTooltip,
} from "../lib/resource-type-tabs";
import { ChromeTooltip } from "./ChromeTooltip";
import { TypeIcon } from "./TypeIcon";

export type ResourceTypeTabDensity = "default" | "wide" | "compact";
export type ResourceTypeTabOverflow = "wrap" | "collapse";

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
  /** `compact` hides type text on a nowrap chip row. Do not use on Add to profile. */
  density?: ResourceTypeTabDensity;
  /**
   * `collapse` is Add to profile / Add to plugin: one row, then `N more` / `Less`.
   * Library and Global/Project inventory stay `wrap`.
   */
  overflow?: ResourceTypeTabOverflow;
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

function overflowClassName(
  overflow: ResourceTypeTabOverflow,
  expanded: boolean,
): string {
  switch (overflow) {
    case "wrap":
      return "";
    case "collapse":
      return [
        "resource-type-tabs-collapse",
        expanded ? "resource-type-tabs-expanded" : "resource-type-tabs-collapsed",
      ].join(" ");
    default: {
      const neverOverflow: never = overflow;
      return neverOverflow;
    }
  }
}

function readPxGap(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).columnGap);
  return Number.isFinite(value) ? value : 0;
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
  overflow = "wrap",
  attention,
}: ResourceTypeTabsProps): ReactNode {
  const labelId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const moreMeasureRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const tabOptions = { includeAll, emptyMode };
  const tabs = visibleResourceTypeTabs(counts, tabOptions);
  const resolved = resolveResourceTypeTab(value, counts, tabOptions);
  const resolvedDensity = resolveTabDensity(density, wide);
  const toggleValue =
    resolved
    ?? (includeAll && tabs.includes(ALL_RESOURCE_TYPE_TAB)
      ? ALL_RESOURCE_TYPE_TAB
      : (tabs[0] ?? ALL_RESOURCE_TYPE_TAB));
  const collapse = overflow === "collapse";
  const visibleCount = Math.max(tabs.length - hiddenCount, 0);
  const showOverflowControl = collapse && hiddenCount > 0;
  const tabMeasureKey = tabs
    .map((type) => `${type}:${resourceTypeTabItemCount(type, counts)}`)
    .join("|");

  useLayoutEffect(() => {
    if (!collapse) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const measure = (): void => {
      const scroller = host.querySelector<HTMLElement>(".resource-type-tabs-scroller");
      if (!scroller) {
        return;
      }
      const items = [
        ...scroller.querySelectorAll<HTMLElement>(":scope > .resource-type-tab"),
      ];
      const previousHidden = items.map((item) => item.hidden);
      for (const item of items) {
        item.hidden = false;
      }
      const itemWidths = items.map((item) => item.getBoundingClientRect().width);
      const moreWidth = moreMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const fit = collapsedTypeTabFit({
        itemWidths,
        containerWidth: host.clientWidth,
        moreWidth,
        gap: readPxGap(scroller),
      });
      for (const [index, item] of items.entries()) {
        item.hidden = previousHidden[index] ?? false;
      }
      setHiddenCount((current) =>
        current === fit.hiddenCount ? current : fit.hiddenCount,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [collapse, tabMeasureKey]);

  if (tabs.length === 0) {
    return null;
  }

  const scroller = (
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
      {tabs.map((type, index) => {
        const label = resourceTypeTabLabel(type);
        const count = resourceTypeTabItemCount(type, counts);
        const caption = resourceTypeTabTooltip(type, counts, tabOptions);
        const empty = resourceTypeTabEmptyDisabled(type, counts);
        const itemDisabled = empty;
        const review = empty ? null : typeTabAttentionTooltip(attention?.get(type));
        const ariaLabel = review ? `${caption}. ${review}` : caption;
        const compact = resolvedDensity === "compact";
        const collapsedHidden =
          collapse && !expanded && index >= visibleCount;
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
            hidden={collapsedHidden}
          >
            {inner}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
  const overflowControl = showOverflowControl ? (
    <button
      type="button"
      className="resource-type-tabs-more"
      disabled={disabled}
      aria-expanded={expanded}
      onClick={() => {
        setExpanded((current) => !current);
      }}
    >
      {expanded ? TYPE_TABS_LESS_LABEL : typeTabsMoreLabel(hiddenCount)}
    </button>
  ) : null;

  return (
    <div
      ref={hostRef}
      className={[
        "resource-type-tabs",
        densityClassName(resolvedDensity),
        overflowClassName(overflow, expanded),
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="sr-only" id={labelId}>
        Resource type
      </span>
      {collapse ? (
        <span
          ref={moreMeasureRef}
          className="resource-type-tabs-more resource-type-tabs-more-measure"
          aria-hidden
        >
          {typeTabsMoreLabel(99)}
        </span>
      ) : null}
      {collapse ? (
        <div className="resource-type-tabs-row">
          {scroller}
          {overflowControl}
        </div>
      ) : (
        scroller
      )}
    </div>
  );
}
