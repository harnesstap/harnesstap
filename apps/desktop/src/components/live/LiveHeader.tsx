import { useState } from "react";
import { ChromeTooltip } from "../ChromeTooltip";
import { ResourceTypeTabs } from "../ResourceTypeTabs";
import {
  EMPTY_TYPES_PILL_HIDE_LABEL,
  emptyInventoryTypeTabs,
  emptyTypesPillHideTooltip,
  emptyTypesPillLabel,
  emptyTypesPillTooltip,
} from "../../lib/profile-inventory";
import type { TypeTabAttention } from "../../lib/resource-type-tabs";

export function ListSearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="list-search">
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        data-workspace-filter=""
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

export interface LiveHeaderProps {
  search: string;
  onSearch: (value: string) => void;
  typeCounts: ReadonlyMap<string, number>;
  attention: ReadonlyMap<string, TypeTabAttention>;
  typeTab: string | null;
  onTypeTab: (next: string | null) => void;
}

export function LiveHeader({
  search,
  onSearch,
  typeCounts,
  attention,
  typeTab,
  onTypeTab,
}: LiveHeaderProps) {
  const [showEmptyTypes, setShowEmptyTypes] = useState(false);
  const emptyTypes = emptyInventoryTypeTabs(typeCounts);
  const showingEmpty = showEmptyTypes && emptyTypes.length > 0;
  const emptyLabel = showingEmpty
    ? EMPTY_TYPES_PILL_HIDE_LABEL
    : emptyTypesPillLabel(emptyTypes.length);
  const emptyTooltip = showingEmpty
    ? emptyTypesPillHideTooltip()
    : emptyTypesPillTooltip(emptyTypes);

  return (
    <div className="scope-inventory-live-header">
      <ListSearchField
        value={search}
        onChange={onSearch}
        placeholder="Filter resources"
        label="Filter resources"
      />
      <div className="scope-inventory-type-row">
        <ResourceTypeTabs
          includeAll={true}
          emptyMode={showingEmpty ? "disable" : "hide"}
          wide
          counts={typeCounts}
          attention={attention}
          value={typeTab}
          onChange={onTypeTab}
        />
        {emptyTypes.length > 0 ? (
          <ChromeTooltip content={emptyTooltip} side="top">
            <button
              type="button"
              className="resource-type-tab resource-type-tab-empty-pill"
              data-testid="resource-type-tab-empty"
              aria-label={emptyTooltip}
              aria-expanded={showingEmpty}
              onClick={() => {
                setShowEmptyTypes((current) => !current);
              }}
            >
              {emptyLabel}
            </button>
          </ChromeTooltip>
        ) : null}
      </div>
    </div>
  );
}
