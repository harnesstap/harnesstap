import { useMemo, useState } from "react";
import { EyeOff, Link2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowMeta,
  ResourceRowRoot,
  ResourceRowTrailing,
} from "@/components/ui/resource-row";
import { SelectionList as UiSelectionList } from "@/components/ui/selection-list";
import {
  compositionSearchType,
  isCompositionPluginPackage,
} from "../lib/composition-membership";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import { duplicatePluginNames } from "../lib/resource-display";
import { hoverModelFromLibraryResource } from "../lib/resource-hover";
import {
  filterLibraryResourcesBySearch,
  resourceDisplayName,
} from "../lib/resource-search";
import {
  countResourceTypeTabs,
  resolveResourceTypeTab,
} from "../lib/resource-type-tabs";
import type { LibraryResource } from "../lib/types";
import { noResultsTitle } from "../lib/empty-copy";
import { ResourceTypeTabs } from "./ResourceTypeTabs";
import { ChromeTooltip } from "./ChromeTooltip";
import { inheritedItemKey, type InheritedItem } from "../lib/api/library-plugins";
import { inheritedRowTooltips } from "../lib/duplicate-profile";

/** Parent items of a kept-in-sync profile, shown inline with its own items. */
export interface InheritedRowsInput {
  items: InheritedItem[];
  parentName: string;
  onToggle?: (item: InheritedItem) => void;
}

export interface SelectionRow {
  id: string;
  name: string;
  description: string | null;
}

export interface SelectionListProps {
  title: string;
  emptyLabel: string;
  rows: SelectionRow[];
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}

export function SelectionList({
  title,
  emptyLabel,
  rows,
  selectedIds,
  disabled,
  onToggle,
}: SelectionListProps) {
  return (
    <UiSelectionList
      title={title}
      emptyLabel={emptyLabel}
      items={rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        testId: `create-plugin-${row.name}`,
      }))}
      selectedIds={selectedIds}
      disabled={disabled}
      onToggle={onToggle}
      idPrefix={`plugins-${title}`}
    />
  );
}

export interface ResourceSelectionListProps {
  resources: LibraryResource[];
  filter: string;
  onFilterChange: (value: string) => void;
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
  onInspect?: (resource: LibraryResource) => void;
  /** Fieldset legend. Empty string hides the legend. */
  title?: string;
  /** Empty copy when the library has no rows (before filtering). */
  emptyUnfilteredLabel?: string;
  /** Rows a kept-in-sync profile gets from its parent; listed first. */
  inherited?: InheritedRowsInput;
}

function InheritedPickerRow({
  item,
  parentName,
  disabled,
  onToggle,
}: {
  item: InheritedItem;
  parentName: string;
  disabled: boolean;
  onToggle?: (item: InheritedItem) => void;
}) {
  const key = inheritedItemKey(item);
  const id = `inherited-${key}`;
  const tips = inheritedRowTooltips(item, parentName);
  return (
    <ResourceRowRoot
      hover={{ type: item.type, name: item.name, harnessIds: [], extra: [] }}
      testId={`inherited-row-${key}`}
      className={item.hidden ? "resource-row-inherited is-hidden" : "resource-row-inherited"}
      disabled={disabled}
    >
      <ResourceRowLeading>
        <ChromeTooltip content={tips.checkbox}>
          <span className="resource-row-checkbox">
            <Checkbox
              id={id}
              checked={!item.hidden}
              disabled={disabled || !onToggle}
              aria-label={item.hidden ? `Include ${item.name}` : `Hide ${item.name}`}
              onCheckedChange={!onToggle ? undefined : () => onToggle(item)}
            />
          </span>
        </ChromeTooltip>
      </ResourceRowLeading>
      <ResourceRowIdentity type={item.type} label={item.name} htmlFor={id} />
      <ResourceRowTrailing>
        <ChromeTooltip content={tips.state}>
          <span className="inherited-row-icon" tabIndex={0} aria-label={tips.state}>
            {item.hidden ? (
              <EyeOff size={14} strokeWidth={2} aria-hidden />
            ) : (
              <Link2 size={14} strokeWidth={2} aria-hidden />
            )}
          </span>
        </ChromeTooltip>
      </ResourceRowTrailing>
    </ResourceRowRoot>
  );
}

function ResourcePickerRow({
  resource,
  selected,
  disabled,
  onToggle,
  onInspect,
  duplicateNames,
}: {
  resource: LibraryResource;
  selected: boolean;
  disabled: boolean;
  onToggle?: (id: string) => void;
  onInspect?: (resource: LibraryResource) => void;
  duplicateNames?: ReadonlySet<string>;
}) {
  const id = `resource-${resource.id}`;
  const label = resourceDisplayName(resource, duplicateNames);
  const rowType = compositionSearchType(resource);
  const inspect =
    !onInspect || isCompositionPluginPackage(resource)
      ? undefined
      : () => {
          onInspect(resource);
        };
  return (
    <ResourceRowRoot
      hover={hoverModelFromLibraryResource(resource, duplicateNames)}
      testId={`create-resource-${label}`}
      disabled={disabled}
      onActivate={inspect}
    >
      <ResourceRowLeading>
        <span
          className="resource-row-checkbox"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            id={id}
            checked={selected}
            disabled={disabled}
            onCheckedChange={
              !onToggle ? undefined : () => onToggle(resource.id)
            }
          />
        </span>
      </ResourceRowLeading>
      {inspect ? (
        <ResourceRowIdentity type={rowType} label={label} onOpen={inspect}>
          {resource.description ? (
            <ResourceRowDescription>{resource.description}</ResourceRowDescription>
          ) : null}
        </ResourceRowIdentity>
      ) : (
        <ResourceRowIdentity type={rowType} label={label} htmlFor={id}>
          {resource.description ? (
            <ResourceRowDescription>{resource.description}</ResourceRowDescription>
          ) : null}
        </ResourceRowIdentity>
      )}
      <ResourceRowMeta
        harnessIds={relatedHarnessesForResourceType(rowType)}
      />
    </ResourceRowRoot>
  );
}

export function ResourceSelectionList({
  resources,
  filter,
  onFilterChange,
  selectedIds,
  disabled,
  onToggle,
  onInspect,
  title = "",
  emptyUnfilteredLabel = "No library items available.",
  inherited,
}: ResourceSelectionListProps) {
  const [typeTab, setTypeTab] = useState<string | null>(null);

  const collidingNames = useMemo(
    () => duplicatePluginNames(resources),
    [resources],
  );
  const filteredResources = useMemo(
    () => filterLibraryResourcesBySearch(resources, filter),
    [filter, resources],
  );
  const filteredInherited = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const items = inherited?.items ?? [];
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  }, [filter, inherited?.items]);
  const typeCounts = useMemo(
    () =>
      countResourceTypeTabs([
        ...filteredInherited.map((item) => item.type),
        ...filteredResources.map((resource) => compositionSearchType(resource)),
      ]),
    [filteredInherited, filteredResources],
  );
  const effectiveType = resolveResourceTypeTab(typeTab, typeCounts);
  const visibleResources = useMemo(() => {
    const rows =
      effectiveType === null
        ? filteredResources
        : filteredResources.filter(
            (resource) => compositionSearchType(resource) === effectiveType,
          );
    return [...rows].sort((left, right) =>
      resourceDisplayName(left, collidingNames).localeCompare(
        resourceDisplayName(right, collidingNames),
      ),
    );
  }, [collidingNames, effectiveType, filteredResources]);

  const visibleInherited = useMemo(
    () =>
      [...(effectiveType === null
        ? filteredInherited
        : filteredInherited.filter((item) => item.type === effectiveType))].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    [effectiveType, filteredInherited],
  );

  const emptyLabel =
    resources.length === 0 && (inherited?.items.length ?? 0) === 0
      ? emptyUnfilteredLabel
      : filter.trim()
        ? noResultsTitle(filter)
        : emptyUnfilteredLabel;

  return (
    <fieldset className="selection-list">
      {title ? <legend>{title}</legend> : null}
      <Input
        className="selection-list-filter h-8 text-xs"
        type="search"
        placeholder="Filter by name"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        aria-label="Filter library items"
      />
      <ResourceTypeTabs
        counts={typeCounts}
        value={effectiveType}
        onChange={setTypeTab}
      />
      <div className="selection-list-viewport">
        <div className="selection-list-rows">
          {visibleInherited.map((item) => (
            <InheritedPickerRow
              key={`inherited-${inheritedItemKey(item)}`}
              item={item}
              parentName={inherited?.parentName ?? ""}
              disabled={disabled}
              onToggle={inherited?.onToggle}
            />
          ))}
          {visibleResources.length === 0 && visibleInherited.length === 0 ? (
            <p className="muted">{emptyLabel}</p>
          ) : (
            visibleResources.map((resource) => (
              <ResourcePickerRow
                key={resource.id}
                resource={resource}
                selected={selectedIds.includes(resource.id)}
                disabled={disabled}
                onToggle={onToggle}
                onInspect={onInspect}
                duplicateNames={collidingNames}
              />
            ))
          )}
        </div>
      </div>
    </fieldset>
  );
}
