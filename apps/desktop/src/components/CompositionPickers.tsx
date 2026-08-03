import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
    <fieldset className="selection-list" disabled={disabled}>
      <legend>{title}</legend>
      <div className="selection-list-rows">
        {rows.length === 0 ? (
          <p className="muted">{emptyLabel}</p>
        ) : (
          rows.map((row) => (
            <label key={row.id} className="selection-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(row.id)}
                onChange={() => onToggle(row.id)}
              />
              <span>
                <strong>{row.name}</strong>
                {row.description ? <small>{row.description}</small> : null}
              </span>
            </label>
          ))
        )}
      </div>
    </fieldset>
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
      <input
        className="selection-list-filter"
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
                        <label key={resource.id} className="selection-row">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(resource.id)}
                            onChange={() => onToggle(resource.id)}
                          />
                          <span>
                            <strong>{resourceDisplayName(resource)}</strong>
                            {resource.description ? (
                              <small>{resource.description}</small>
                            ) : null}
                          </span>
                        </label>
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
                    <div key={resource.id} className="selection-row">
                      <input type="checkbox" tabIndex={-1} readOnly />
                      <span>
                        <strong>{resourceDisplayName(resource)}</strong>
                        {resource.description ? (
                          <small>{resource.description}</small>
                        ) : null}
                      </span>
                    </div>
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
