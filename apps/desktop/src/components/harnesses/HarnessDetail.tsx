import { useMemo } from "react";
import { FilterX, Star } from "lucide-react";
import { noResultsTitle } from "../../lib/empty-copy";
import {
  diskPresenceLabel,
  filterHarnessLocations,
  groupHarnessLocationsByType,
  harnessSummary,
  isHarnessFacetFilterActive,
  NO_ATTENTION,
  type HarnessEntry,
  type HarnessResourceRow,
  type HarnessRole,
} from "../../lib/harness-inventory";
import { genericHarnessTooltip } from "../../lib/harness-settings-form";
import { EmptyState } from "../EmptyState";
import { HarnessIcon } from "../HarnessIcons";
import { IconActionButton } from "../IconActionButton";
import { LiveHeader } from "../live/LiveHeader";
import { HarnessFilterMenu } from "./HarnessFilterMenu";
import { HarnessInventoryList } from "./HarnessInventoryList";

const ICON_SIZE = 16;
const TITLE_ICON_SIZE = 18;

export interface HarnessDetailProps {
  entry: HarnessEntry;
  role: HarnessRole;
  search: string;
  typeTab: string | null;
  originIds: readonly string[];
  marketplaceIds: readonly string[];
  disabled: boolean;
  onSearch: (value: string) => void;
  onTypeTab: (value: string | null) => void;
  onOriginIds: (value: readonly string[]) => void;
  onMarketplaceIds: (value: readonly string[]) => void;
  onMakeMain: () => void;
  onOpen: (row: HarnessResourceRow) => void;
}

function subtitle(entry: HarnessEntry): string {
  const summary = harnessSummary(entry);
  return entry.disk === "detected"
    ? summary
    : `${summary} · ${diskPresenceLabel(entry.disk)}`;
}

export function HarnessDetail({
  entry,
  role,
  search,
  typeTab,
  originIds,
  marketplaceIds,
  disabled,
  onSearch,
  onTypeTab,
  onOriginIds,
  onMarketplaceIds,
  onMakeMain,
  onOpen,
}: HarnessDetailProps) {
  const filtered = useMemo(
    () =>
      filterHarnessLocations(entry, search, typeTab, {
        origins: new Set(originIds),
        marketplaces: new Set(marketplaceIds),
      }),
    [entry, marketplaceIds, originIds, search, typeTab],
  );
  const groups = useMemo(
    () => groupHarnessLocationsByType(entry, filtered.locations),
    [entry, filtered.locations],
  );
  const filtering =
    search.trim().length > 0
    || typeTab !== null
    || isHarnessFacetFilterActive({
      origins: new Set(originIds),
      marketplaces: new Set(marketplaceIds),
    });
  const clearFilters = () => {
    onSearch("");
    onTypeTab(null);
    onOriginIds([]);
    onMarketplaceIds([]);
  };
  const empty = groups.length === 0;

  return (
    <div className="edit-profile-body harness-detail" data-testid="harness-detail">
      <div className="edit-profile-header">
        <div className="edit-profile-title harness-detail-title">
          <h2>
            <HarnessIcon id={entry.id} size={TITLE_ICON_SIZE} tooltip={false} />
            {entry.name}
            {role === "main" ? <span className="badge">main</span> : null}
          </h2>
          <p className="muted">{subtitle(entry)}</p>
          {!entry.supported ? (
            <p className="muted">{genericHarnessTooltip([...entry.supports])}</p>
          ) : null}
        </div>
        <div className="edit-profile-header-actions">
          {role !== "main" ? (
            <IconActionButton
              data-testid="make-main-harness"
              label="Make main harness"
              disabled={disabled}
              onClick={onMakeMain}
              icon={<Star size={ICON_SIZE} aria-hidden />}
            />
          ) : null}
        </div>
      </div>
      <LiveHeader
        search={search}
        onSearch={onSearch}
        typeCounts={filtered.typeCounts}
        attention={NO_ATTENTION}
        typeTab={typeTab}
        onTypeTab={onTypeTab}
        compactSearch
        searchTrailing={
          <HarnessFilterMenu
            entry={entry}
            originIds={originIds}
            marketplaceIds={marketplaceIds}
            disabled={disabled}
            onOriginsChange={onOriginIds}
            onMarketplacesChange={onMarketplaceIds}
          />
        }
      />
      {empty ? (
        filtering ? (
          <EmptyState
            title={noResultsTitle(search)}
            body="Clear filters to see every resource."
            action={{
              label: "Clear filters",
              onClick: clearFilters,
              icon: <FilterX size={ICON_SIZE} aria-hidden />,
            }}
          />
        ) : (
          <EmptyState
            title="No resources"
            body="This harness declares no global paths."
          />
        )
      ) : (
        <HarnessInventoryList
          entry={entry}
          locations={filtered.locations}
          disabled={disabled}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
