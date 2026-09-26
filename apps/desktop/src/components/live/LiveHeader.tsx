import type { ReactNode } from "react";
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
    <div className="list-search">
      <label>
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
    </div>
  );
}

export interface LiveHeaderProps {
  search: string;
  onSearch: (value: string) => void;
  typeCounts: ReadonlyMap<string, number>;
  attention: ReadonlyMap<string, TypeTabAttention>;
  typeTab: string | null;
  onTypeTab: (next: string | null) => void;
  searchTrailing?: ReactNode;
}

export function LiveHeader({
  search,
  onSearch,
  typeCounts,
  attention,
  typeTab,
  onTypeTab,
  searchTrailing,
}: LiveHeaderProps) {
  const searchField = (
    <ListSearchField
      value={search}
      onChange={onSearch}
      placeholder="Filter resources"
      label="Filter resources"
    />
  );
  return (
    <div className="scope-inventory-live-header">
      {searchTrailing ? (
        <div className="list-search-row">
          {searchField}
          {searchTrailing}
        </div>
      ) : (
        searchField
      )}
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
