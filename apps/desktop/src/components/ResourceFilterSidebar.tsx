import { useDeferredValue, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { FilterX } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconActionButton } from "./IconActionButton";
import {
  buildNamespaceFacetOptions,
  buildOriginFacetOptions,
  formatOriginKindLabel,
  isResourceFilterStateActive,
  isUpdatedFilterValid,
  originFilterValue,
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

const UPDATED_PRESETS: Array<{
  id: UpdatedPreset;
  label: string;
}> = [
  { id: "all", label: "All time" },
  { id: "1d", label: "1d" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "custom", label: "Custom" },
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
  return originKind === null ? ORIGIN_ALL : originFilterValue(originKind);
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
  if (originKind === null) {
    return options;
  }
  const grouped = originFilterValue(originKind);
  if (options.includes(grouped)) {
    return options;
  }
  return [...options, grouped];
}

function FilterCombobox({
  id,
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  options: ComboboxOption[];
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="resource-filter-section">
      <label className="eyebrow" htmlFor={id}>
        {label}
      </label>
      <Combobox
        id={id}
        value={value}
        options={options}
        disabled={disabled}
        placeholder={label}
        onValueChange={onValueChange}
      />
    </div>
  );
}

export function ResourceFilterSidebar({
  resources,
  state,
  onChange,
  onClear,
  disabled = false,
  searchInputRef,
}: ResourceFilterSidebarProps) {
  const [searchInput, setSearchInput] = useState(state.search);
  const deferredSearch = useDeferredValue(searchInput);
  const namespaceOptions = useMemo((): ComboboxOption[] => {
    const facets = withCurrentNamespaceOption(
      buildNamespaceFacetOptions(resources),
      state.namespace,
    );
    return [
      { value: NAMESPACE_ALL, label: "All" },
      ...facets.map((option) =>
        option.mode === "unnamed"
          ? { value: NAMESPACE_UNNAMED, label: "None" }
          : {
              value: namespaceSelectValue({
                mode: "named",
                value: option.value,
              }),
              label: option.value,
            },
      ),
    ];
  }, [resources, state.namespace]);
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

  useEffect(() => {
    setSearchInput(state.search);
  }, [state.search]);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (deferredSearch === stateRef.current.search) {
      return;
    }
    onChange({ ...stateRef.current, search: deferredSearch });
  }, [deferredSearch, onChange]);

  return (
    <aside className="resource-filter-sidebar" aria-label="Resource filters">
      <div className="resource-filter-section">
        <div className="resource-filter-search-row">
          <input
            ref={searchInputRef}
            className="resources-panel-filter"
            type="search"
            placeholder="Filter by name"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            disabled={disabled}
            aria-label="Filter resources"
          />
          <IconActionButton
            className="resource-filter-clear"
            label="Clear filters"
            disabled={disabled || !dirty}
            onClick={onClear}
            icon={<FilterX size={16} aria-hidden />}
          />
        </div>
      </div>

      <div className="resource-filter-section">
        <span className="eyebrow">Updated</span>
        <Select
          value={state.updated.preset}
          disabled={disabled}
          onValueChange={(value) => {
            const preset = value as UpdatedPreset;
            onChange({
              ...state,
              updated:
                preset === "custom"
                  ? { ...state.updated, preset }
                  : { preset, from: null, to: null },
            });
          }}
        >
          <SelectTrigger
            className="resource-filter-updated-select"
            aria-label="Updated at"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UPDATED_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <FilterCombobox
        id="resource-filter-namespace"
        label="Namespace"
        value={namespaceSelectValue(state.namespace)}
        options={namespaceOptions}
        disabled={disabled}
        onValueChange={(value) =>
          onChange({ ...state, namespace: namespaceFromSelectValue(value) })
        }
      />

      <fieldset className="resource-filter-section">
        <legend className="eyebrow">Origin</legend>
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
        {origins.map((origin) => {
          const selected = originSelectValue(state.originKind) === origin;
          return (
            <label
              key={origin}
              className={`resource-filter-option${selected ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="resource-filter-origin"
                checked={selected}
                disabled={disabled}
                onChange={() => onChange({ ...state, originKind: origin })}
              />
              <span>{formatOriginKindLabel(origin)}</span>
            </label>
          );
        })}
      </fieldset>
    </aside>
  );
}
