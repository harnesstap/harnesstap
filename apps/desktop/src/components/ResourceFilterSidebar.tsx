import { useMemo, type ReactNode, type Ref } from "react";
import { FilterX } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LISTABLE_FILTER_RESOURCE_TYPES,
  buildNamespaceFacetOptions,
  buildOriginFacetOptions,
  formatOriginKindLabel,
  isResourceFilterStateActive,
  isUpdatedFilterValid,
  type NamespaceFacetOption,
  type NamespaceSelection,
  type ResourceFilterState,
  type UpdatedPreset,
} from "../lib/resource-filters";
import type { LibraryResource } from "../lib/types";

export interface ResourceFilterSidebarProps {
  resources: LibraryResource[];
  state: ResourceFilterState;
  onChange: (next: ResourceFilterState) => void;
  onClear: () => void;
  disabled?: boolean;
  searchInputRef?: Ref<HTMLInputElement>;
}

const UPDATED_SEGMENT_PRESETS: Array<{
  id: Exclude<UpdatedPreset, "custom">;
  label: string;
}> = [
  { id: "all", label: "All time" },
  { id: "1d", label: "1d" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
];

const CUSTOM_DATE_RANGE_HINT_ID = "resource-filter-custom-date-hint";
const NAMESPACE_ALL = "all";
const NAMESPACE_UNNAMED = "unnamed";
const NAMESPACE_NAMED_PREFIX = "named:";
const ORIGIN_ALL = "all";

function namespaceSelectValue(selection: NamespaceSelection): string {
  switch (selection.mode) {
    case "all":
      return NAMESPACE_ALL;
    case "unnamed":
      return NAMESPACE_UNNAMED;
    case "named":
      return `${NAMESPACE_NAMED_PREFIX}${selection.value}`;
    default: {
      const _exhaustive: never = selection;
      return _exhaustive;
    }
  }
}

function namespaceFromSelectValue(value: string): NamespaceSelection {
  if (value === NAMESPACE_ALL) {
    return { mode: "all" };
  }
  if (value === NAMESPACE_UNNAMED) {
    return { mode: "unnamed" };
  }
  if (value.startsWith(NAMESPACE_NAMED_PREFIX)) {
    return { mode: "named", value: value.slice(NAMESPACE_NAMED_PREFIX.length) };
  }
  return { mode: "named", value };
}

function originSelectValue(originKind: string | null): string {
  return originKind ?? ORIGIN_ALL;
}

function originFromSelectValue(value: string): string | null {
  return value === ORIGIN_ALL ? null : value;
}

function withCurrentNamespaceOption(
  options: NamespaceFacetOption[],
  selection: NamespaceSelection,
): NamespaceFacetOption[] {
  if (selection.mode !== "named") {
    return options;
  }
  const present = options.some(
    (option) => option.mode === "named" && option.value === selection.value,
  );
  return present ? options : [...options, { mode: "named", value: selection.value }];
}

function withCurrentOriginOption(
  options: string[],
  originKind: string | null,
): string[] {
  if (originKind === null || options.includes(originKind)) {
    return options;
  }
  return [...options, originKind];
}

function FilterSelect({
  id,
  label,
  value,
  disabled,
  onValueChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="resource-filter-section">
      <label className="resource-filter-section-label" htmlFor={id}>
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

function typeCounts(resources: LibraryResource[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  }
  return counts;
}

export function ResourceFilterSidebar({
  resources,
  state,
  onChange,
  onClear,
  disabled = false,
  searchInputRef,
}: ResourceFilterSidebarProps) {
  const counts = useMemo(() => typeCounts(resources), [resources]);
  const namespaces = useMemo(
    () =>
      withCurrentNamespaceOption(
        buildNamespaceFacetOptions(resources),
        state.namespace,
      ),
    [resources, state.namespace],
  );
  const origins = useMemo(
    () =>
      withCurrentOriginOption(
        buildOriginFacetOptions(resources),
        state.originKind,
      ),
    [resources, state.originKind],
  );
  const dirty = isResourceFilterStateActive(state);
  const customInvalid =
    state.updated.preset === "custom" && !isUpdatedFilterValid(state.updated);

  return (
    <aside className="resource-filter-sidebar" aria-label="Resource filters">
      <div className="resource-filter-section">
        <div className="resource-filter-search-row">
          <input
            ref={searchInputRef}
            className="resources-panel-filter"
            type="search"
            placeholder="Filter (skill:name)…"
            value={state.search}
            onChange={(event) =>
              onChange({ ...state, search: event.target.value })
            }
            disabled={disabled}
            aria-label="Filter resources"
          />
          <button
            type="button"
            className="icon-action resource-filter-clear"
            aria-label="Clear filters"
            title="Clear filters"
            disabled={disabled || !dirty}
            onClick={onClear}
          >
            <FilterX size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="resource-filter-section">
        <span className="resource-filter-section-label">Type</span>
        <div className="resource-filter-type-badges" role="group" aria-label="Resource type">
          <button
            type="button"
            className={`resource-filter-type-badge${state.type === null ? " on" : ""}`}
            aria-pressed={state.type === null}
            disabled={disabled}
            onClick={() => onChange({ ...state, type: null })}
          >
            All
          </button>
          {LISTABLE_FILTER_RESOURCE_TYPES.map((type) => {
            const count = counts.get(type) ?? 0;
            const on = state.type === type;
            return (
              <button
                key={type}
                type="button"
                className={`resource-filter-type-badge${on ? " on" : ""}${count === 0 ? " empty" : ""}`}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange({ ...state, type })}
              >
                {type}
              </button>
            );
          })}
        </div>
      </div>

      <div className="resource-filter-section">
        <span className="resource-filter-section-label">Updated</span>
        <div
          className="segment resource-filter-updated-segment"
          role="group"
          aria-label="Updated at"
        >
          {UPDATED_SEGMENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={state.updated.preset === preset.id ? "on" : undefined}
              aria-pressed={state.updated.preset === preset.id}
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...state,
                  updated: { preset: preset.id, from: null, to: null },
                })
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`link-btn resource-filter-updated-custom${
            state.updated.preset === "custom" ? " on" : ""
          }`}
          aria-pressed={state.updated.preset === "custom"}
          disabled={disabled}
          onClick={() =>
            onChange({
              ...state,
              updated: { ...state.updated, preset: "custom" },
            })
          }
        >
          Custom
        </button>
        {state.updated.preset === "custom" ? (
          <div className="resource-filter-custom-dates">
            <label>
              From
              <input
                type="date"
                value={state.updated.from ?? ""}
                disabled={disabled}
                aria-invalid={customInvalid}
                aria-describedby={
                  customInvalid ? CUSTOM_DATE_RANGE_HINT_ID : undefined
                }
                onChange={(event) =>
                  onChange({
                    ...state,
                    updated: {
                      preset: "custom",
                      from: event.target.value || null,
                      to: state.updated.to,
                    },
                  })
                }
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={state.updated.to ?? ""}
                disabled={disabled}
                aria-invalid={customInvalid}
                aria-describedby={
                  customInvalid ? CUSTOM_DATE_RANGE_HINT_ID : undefined
                }
                onChange={(event) =>
                  onChange({
                    ...state,
                    updated: {
                      preset: "custom",
                      from: state.updated.from,
                      to: event.target.value || null,
                    },
                  })
                }
              />
            </label>
            {customInvalid ? (
              <p
                id={CUSTOM_DATE_RANGE_HINT_ID}
                className="resource-filter-hint"
                role="alert"
              >
                Choose a valid from ≤ to range.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <FilterSelect
        id="resource-filter-namespace"
        label="Namespace"
        value={namespaceSelectValue(state.namespace)}
        disabled={disabled}
        onValueChange={(value) =>
          onChange({ ...state, namespace: namespaceFromSelectValue(value) })
        }
      >
        <SelectItem value={NAMESPACE_ALL}>All</SelectItem>
        {namespaces.map((option) => {
          const selection: NamespaceSelection =
            option.mode === "unnamed"
              ? { mode: "unnamed" }
              : { mode: "named", value: option.value };
          const value = namespaceSelectValue(selection);
          return (
            <SelectItem key={value} value={value}>
              {option.mode === "unnamed" ? "None" : option.value}
            </SelectItem>
          );
        })}
      </FilterSelect>

      <FilterSelect
        id="resource-filter-origin"
        label="Origin"
        value={originSelectValue(state.originKind)}
        disabled={disabled}
        onValueChange={(value) =>
          onChange({ ...state, originKind: originFromSelectValue(value) })
        }
      >
        <SelectItem value={ORIGIN_ALL}>All</SelectItem>
        {origins.map((origin) => (
          <SelectItem key={origin} value={origin}>
            {formatOriginKindLabel(origin)}
          </SelectItem>
        ))}
      </FilterSelect>
    </aside>
  );
}
