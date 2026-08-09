import { useMemo, type Ref } from "react";
import { FilterX } from "lucide-react";
import {
  LISTABLE_FILTER_RESOURCE_TYPES,
  buildNamespaceFacetOptions,
  buildOriginFacetOptions,
  formatOriginKindLabel,
  isResourceFilterStateActive,
  isUpdatedFilterValid,
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
    () => buildNamespaceFacetOptions(resources),
    [resources],
  );
  const origins = useMemo(() => buildOriginFacetOptions(resources), [resources]);
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

      <fieldset className="resource-filter-section">
        <legend className="resource-filter-section-label">Namespace</legend>
        <label
          className={`resource-filter-option${state.namespace.mode === "all" ? " selected" : ""}`}
        >
          <input
            type="radio"
            name="resource-filter-namespace"
            checked={state.namespace.mode === "all"}
            disabled={disabled}
            onChange={() => onChange({ ...state, namespace: { mode: "all" } })}
          />
          <span>All</span>
        </label>
        {namespaces.map((option) => {
          const selected =
            option.mode === "unnamed"
              ? state.namespace.mode === "unnamed"
              : state.namespace.mode === "named" &&
                state.namespace.value === option.value;
          const selection: NamespaceSelection =
            option.mode === "unnamed"
              ? { mode: "unnamed" }
              : { mode: "named", value: option.value };
          const key =
            option.mode === "unnamed" ? "unnamed" : `named:${option.value}`;
          return (
            <label
              key={key}
              className={`resource-filter-option${selected ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="resource-filter-namespace"
                checked={selected}
                disabled={disabled}
                onChange={() => onChange({ ...state, namespace: selection })}
              />
              <span>{option.mode === "unnamed" ? "None" : option.value}</span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className="resource-filter-section">
        <legend className="resource-filter-section-label">Origin</legend>
        <label
          className={`resource-filter-option${state.originKind === null ? " selected" : ""}`}
        >
          <input
            type="radio"
            name="resource-filter-origin"
            checked={state.originKind === null}
            disabled={disabled}
            onChange={() => onChange({ ...state, originKind: null })}
          />
          <span>All</span>
        </label>
        {origins.map((origin) => (
          <label
            key={origin}
            className={`resource-filter-option${state.originKind === origin ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="resource-filter-origin"
              checked={state.originKind === origin}
              disabled={disabled}
              onChange={() => onChange({ ...state, originKind: origin })}
            />
            <span>{formatOriginKindLabel(origin)}</span>
          </label>
        ))}
      </fieldset>
    </aside>
  );
}
