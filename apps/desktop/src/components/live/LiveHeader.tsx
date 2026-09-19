import { ChromeTooltip } from "../ChromeTooltip";
import { ResourceTypeTabs } from "../ResourceTypeTabs";
import {
  emptyInventoryTypeTabs,
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
  const emptyTypes = emptyInventoryTypeTabs(typeCounts);
  const emptyLabel = emptyTypesPillLabel(emptyTypes.length);
  const emptyTooltip = emptyTypesPillTooltip(emptyTypes);

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
          emptyMode="hide"
          wide
          counts={typeCounts}
          attention={attention}
          value={typeTab}
          onChange={onTypeTab}
        />
        {emptyTypes.length > 0 ? (
          <ChromeTooltip content={emptyTooltip} side="top">
            <span
              className="resource-type-tab resource-type-tab-empty-pill"
              data-testid="resource-type-tab-empty"
              aria-label={emptyTooltip}
            >
              {emptyLabel}
            </span>
          </ChromeTooltip>
        ) : null}
      </div>
    </div>
  );
}
