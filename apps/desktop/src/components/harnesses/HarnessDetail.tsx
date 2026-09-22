import { useMemo } from "react";
import { FilterX, Star } from "lucide-react";
import { noResultsTitle } from "../../lib/empty-copy";
import {
  diskPresenceLabel,
  filterHarnessLocations,
  harnessSummary,
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
import { HarnessLocationPanel } from "./HarnessLocationPanel";

const ICON_SIZE = 16;
const TITLE_ICON_SIZE = 18;

export interface HarnessDetailProps {
  entry: HarnessEntry;
  role: HarnessRole;
  search: string;
  typeTab: string | null;
  expandedLocations: ReadonlySet<string>;
  disabled: boolean;
  onSearch: (value: string) => void;
  onTypeTab: (value: string | null) => void;
  onMakeMain: () => void;
  onShowAll: (path: string) => void;
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
  expandedLocations,
  disabled,
  onSearch,
  onTypeTab,
  onMakeMain,
  onShowAll,
  onOpen,
}: HarnessDetailProps) {
  const filtered = useMemo(
    () => filterHarnessLocations(entry, search, typeTab),
    [entry, search, typeTab],
  );
  const filtering = search.trim().length > 0 || typeTab !== null;
  const clearFilters = () => {
    onSearch("");
    onTypeTab(null);
  };

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
      />
      {filtered.locations.length === 0 ? (
        filtering ? (
          <EmptyState
            title={noResultsTitle(search)}
            body="Clear filters to see every location."
            action={{
              label: "Clear filters",
              onClick: clearFilters,
              icon: <FilterX size={ICON_SIZE} aria-hidden />,
            }}
          />
        ) : (
          <EmptyState
            title="No locations"
            body="This harness declares no global paths."
          />
        )
      ) : (
        <div className="harness-location-list">
          {filtered.locations.map((location) => (
            <HarnessLocationPanel
              key={location.path}
              location={location}
              expanded={expandedLocations.has(location.path)}
              disabled={disabled}
              onShowAll={() => onShowAll(location.path)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}
