import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowMeta,
  ResourceRowRoot,
} from "@/components/ui/resource-row";
import { SelectionList as UiSelectionList } from "@/components/ui/selection-list";
import {
  compositionSearchType,
  isCompositionPluginPackage,
} from "../lib/composition-membership";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
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
import { ResourceTypeTabs } from "./ResourceTypeTabs";

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
}

function ResourcePickerRow({
  resource,
  selected,
  disabled,
  onToggle,
  onInspect,
}: {
  resource: LibraryResource;
  selected: boolean;
  disabled: boolean;
  onToggle?: (id: string) => void;
  onInspect?: (resource: LibraryResource) => void;
}) {
  const id = `resource-${resource.id}`;
  const label = resourceDisplayName(resource);
  const rowType = compositionSearchType(resource);
  const inspect =
    !onInspect || isCompositionPluginPackage(resource)
      ? undefined
      : () => {
          onInspect(resource);
        };
  return (
    <ResourceRowRoot
      hover={hoverModelFromLibraryResource(resource)}
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
}: ResourceSelectionListProps) {
  const [typeTab, setTypeTab] = useState<string | null>(null);

  const filteredResources = useMemo(
    () => filterLibraryResourcesBySearch(resources, filter),
    [filter, resources],
  );
  const typeCounts = useMemo(
    () =>
      countResourceTypeTabs(
        filteredResources.map((resource) => compositionSearchType(resource)),
      ),
    [filteredResources],
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
      resourceDisplayName(left).localeCompare(resourceDisplayName(right)),
    );
  }, [effectiveType, filteredResources]);

  const emptyLabel =
    resources.length === 0
      ? emptyUnfilteredLabel
      : filter.trim()
        ? "No matches."
        : emptyUnfilteredLabel;

  return (
    <fieldset className="selection-list" disabled={disabled}>
      {title ? <legend>{title}</legend> : null}
      <Input
        className="selection-list-filter h-8 text-xs"
        type="search"
        placeholder="Filter by name or type"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        disabled={disabled}
        aria-label="Filter library items"
      />
      <ResourceTypeTabs
        counts={typeCounts}
        value={effectiveType}
        disabled={disabled}
        onChange={setTypeTab}
      />
      <div className="selection-list-viewport">
        <div className="selection-list-rows">
          {visibleResources.length === 0 ? (
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
              />
            ))
          )}
        </div>
      </div>
    </fieldset>
  );
}
