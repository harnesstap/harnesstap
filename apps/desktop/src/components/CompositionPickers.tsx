import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import { hoverModelFromLibraryResource } from "../lib/resource-hover";
import {
  filterLibraryResourcesBySearch,
  groupLibraryResourcesByType,
  resourceDisplayName,
} from "../lib/resource-search";
import type { LibraryResource } from "../lib/types";

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
}

function ResourcePickerRow({
  resource,
  selected,
  disabled,
  onToggle,
  measure = false,
}: {
  resource: LibraryResource;
  selected: boolean;
  disabled: boolean;
  onToggle?: (id: string) => void;
  measure?: boolean;
}) {
  const id = measure
    ? `resource-${resource.id}-measure`
    : `resource-${resource.id}`;
  const label = resourceDisplayName(resource);
  return (
    <ResourceRowRoot
      hover={hoverModelFromLibraryResource(resource)}
      testId={measure ? undefined : `create-resource-${label}`}
      disabled={disabled}
    >
      <ResourceRowLeading>
        <Checkbox
          id={id}
          checked={selected}
          disabled={disabled}
          tabIndex={measure ? -1 : undefined}
          aria-hidden={measure || undefined}
          onCheckedChange={
            measure || !onToggle ? undefined : () => onToggle(resource.id)
          }
        />
      </ResourceRowLeading>
      <ResourceRowIdentity type={resource.type} label={label} htmlFor={id}>
        {resource.description ? (
          <ResourceRowDescription>{resource.description}</ResourceRowDescription>
        ) : null}
      </ResourceRowIdentity>
      <ResourceRowMeta
        harnessIds={relatedHarnessesForResourceType(resource.type)}
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
}: ResourceSelectionListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [autoExpandAll, setAutoExpandAll] = useState(false);
  const [manualExpanded, setManualExpanded] = useState<
    Record<string, boolean>
  >({});

  const filteredResources = useMemo(
    () => filterLibraryResourcesBySearch(resources, filter),
    [filter, resources],
  );
  const groups = useMemo(
    () => groupLibraryResourcesByType(filteredResources),
    [filteredResources],
  );

  useEffect(() => {
    setManualExpanded({});
  }, [filter, resources]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const measure = measureRef.current;
    if (!list || !measure || filteredResources.length === 0) {
      setAutoExpandAll(false);
      return;
    }

    const updateAutoExpand = () => {
      setAutoExpandAll(measure.scrollHeight <= list.clientHeight);
    };

    updateAutoExpand();
    const observer = new ResizeObserver(updateAutoExpand);
    observer.observe(list);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [filteredResources, groups]);

  const emptyLabel =
    resources.length === 0
      ? "No resources available."
      : filter.trim()
        ? "No matches."
        : "No resources available.";

  const isExpanded = (type: string): boolean => {
    const manual = manualExpanded[type];
    if (manual !== undefined) {
      return manual;
    }
    return autoExpandAll;
  };

  const toggleGroup = (type: string) => {
    setManualExpanded((current) => {
      const currentlyExpanded =
        current[type] !== undefined ? current[type] : autoExpandAll;
      return {
        ...current,
        [type]: !currentlyExpanded,
      };
    });
  };

  return (
    <fieldset className="selection-list" disabled={disabled}>
      <legend>Resources</legend>
      <Input
        className="selection-list-filter h-8 text-xs"
        type="search"
        placeholder="Filter (skill:name)…"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        disabled={disabled}
        aria-label="Filter resources"
      />
      <div className="selection-list-viewport">
        <div className="selection-list-rows" ref={listRef}>
          {filteredResources.length === 0 ? (
            <p className="muted">{emptyLabel}</p>
          ) : (
            groups.map((group) => {
              const expanded = isExpanded(group.type);
              return (
                <section
                  className={`selection-type-group${expanded ? " expanded" : ""}`}
                  key={group.type}
                  aria-label={group.type}
                >
                  <button
                    className="selection-type-heading"
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleGroup(group.type)}
                    disabled={disabled}
                  >
                    <span className="selection-type-chevron" aria-hidden>
                      {expanded ? "▾" : "▸"}
                    </span>
                    <span>{group.type}</span>
                    <span className="selection-type-count">
                      {group.resources.length}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="selection-type-body">
                      {group.resources.map((resource) => (
                        <ResourcePickerRow
                          key={resource.id}
                          resource={resource}
                          selected={selectedIds.includes(resource.id)}
                          disabled={disabled}
                          onToggle={onToggle}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
        {filteredResources.length > 0 ? (
          <div
            className="selection-list-rows selection-list-rows-measure"
            ref={measureRef}
            aria-hidden
          >
            {groups.map((group) => (
              <section className="selection-type-group expanded" key={group.type}>
                <div className="selection-type-heading">
                  <span className="selection-type-chevron" aria-hidden>
                    ▾
                  </span>
                  <span>{group.type}</span>
                  <span className="selection-type-count">
                    {group.resources.length}
                  </span>
                </div>
                <div className="selection-type-body">
                  {group.resources.map((resource) => (
                    <ResourcePickerRow
                      key={resource.id}
                      resource={resource}
                      selected={false}
                      disabled
                      measure
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
