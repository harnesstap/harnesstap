import type { ReactNode } from "react";
import { ResourceTypeTabs } from "../ResourceTypeTabs";
import type { TypeTabAttention } from "../../lib/resource-type-tabs";

export function ListSearchField({
  value,
  onChange,
  placeholder,
  label,
  compact = false,
  trailing,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  compact?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={["list-search", compact ? "list-search-compact" : ""]
        .filter(Boolean)
        .join(" ")}
    >
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
      {trailing ? <span className="list-search-trailing">{trailing}</span> : null}
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
  compactSearch?: boolean;
  searchTrailing?: ReactNode;
}

export function LiveHeader({
  search,
  onSearch,
  typeCounts,
  attention,
  typeTab,
  onTypeTab,
  compactSearch = false,
  searchTrailing,
}: LiveHeaderProps) {
  return (
    <div className="scope-inventory-live-header">
      <ListSearchField
        value={search}
        onChange={onSearch}
        placeholder="Filter resources"
        label="Filter resources"
        compact={compactSearch}
        trailing={searchTrailing}
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
