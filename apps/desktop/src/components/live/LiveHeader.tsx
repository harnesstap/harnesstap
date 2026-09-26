import { ResourceTypeTabs } from "../ResourceTypeTabs";
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
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
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
          emptyMode="disable"
          wide
          counts={typeCounts}
          attention={attention}
          value={typeTab}
          onChange={onTypeTab}
        />
      </div>
    </div>
  );
}
