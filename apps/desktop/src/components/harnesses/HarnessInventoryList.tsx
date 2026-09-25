import {
  groupHarnessLocationsByType,
  truncateResourceBadgeName,
  type HarnessEntry,
  type HarnessLocation,
  type HarnessResourceRow,
  type HarnessTypeSection,
} from "../../lib/harness-inventory";
import type { ResourceHoverModel } from "../../lib/resource-hover";
import { resourceTypeTabLabel } from "../../lib/resource-type-tabs";
import { ChromeTooltip } from "../ChromeTooltip";
import { HarnessIcon } from "../HarnessIcons";
import { TypeIcon } from "../TypeIcon";
import { ResourceHoverCard } from "../ui/resource-hover-card";

const TITLE_ICON_SIZE = 16;

export interface HarnessInventoryListProps {
  entry: HarnessEntry;
  locations: readonly HarnessLocation[];
  disabled: boolean;
  onOpen: (row: HarnessResourceRow) => void;
}

function rowKey(row: HarnessResourceRow): string {
  return row.id || `${row.type}:${row.name}:${row.source}`;
}

function badgeHover(row: HarnessResourceRow): ResourceHoverModel {
  return {
    type: row.type,
    name: row.name,
    showName: true,
    path: row.source,
    harnessIds: [],
    extra: [],
  };
}

function ResourceBadge({
  row,
  disabled,
  onOpen,
}: {
  row: HarnessResourceRow;
  disabled: boolean;
  onOpen: (row: HarnessResourceRow) => void;
}) {
  const label = truncateResourceBadgeName(row.name);
  const clickable = Boolean(row.id) && !disabled;
  const className = "resource-type-tab harness-resource-badge";

  const face = clickable ? (
    <button
      type="button"
      className={className}
      disabled={disabled}
      data-testid={`harness-resource-${row.name}`}
      aria-label={row.name}
      onClick={() => onOpen(row)}
    >
      {label}
    </button>
  ) : (
    <span
      className={`${className} is-static`}
      data-testid={`harness-resource-${row.name}`}
      aria-label={row.name}
    >
      {label}
    </span>
  );

  return (
    <ResourceHoverCard model={badgeHover(row)} disabled={disabled}>
      {face}
    </ResourceHoverCard>
  );
}

function HarnessTypeSectionBlock({
  type,
  section,
  disabled,
  onOpen,
}: {
  type: string;
  section: HarnessTypeSection;
  disabled: boolean;
  onOpen: (row: HarnessResourceRow) => void;
}) {
  return (
    <section
      className="harness-type-section"
      aria-label={`${section.owner.name} ${resourceTypeTabLabel(type)}`}
      data-testid="harness-location"
      data-path={section.path}
    >
      <ChromeTooltip content={section.path}>
        <button type="button" className="harness-type-section-title">
          <HarnessIcon id={section.owner.iconId} size={TITLE_ICON_SIZE} tooltip={false} />
          <span>{section.owner.name}</span>
        </button>
      </ChromeTooltip>
      {section.resources.length === 0 ? (
        <p className="muted harness-location-empty">Nothing here yet.</p>
      ) : (
        <div className="harness-resource-badges">
          {section.resources.map((row) => (
            <ResourceBadge
              key={rowKey(row)}
              row={row}
              disabled={disabled}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HarnessInventoryList({
  entry,
  locations,
  disabled,
  onOpen,
}: HarnessInventoryListProps) {
  const groups = groupHarnessLocationsByType(entry, locations);

  return (
    <div className="harness-type-list">
      {groups.map((group) => (
        <section
          key={group.type}
          className="harness-type-group"
          aria-label={resourceTypeTabLabel(group.type)}
          data-testid="harness-type-group"
          data-type={group.type}
        >
          <h3 className="harness-type-heading">
            <TypeIcon type={group.type} />
            <span>{resourceTypeTabLabel(group.type)}</span>
          </h3>
          {group.sections.map((section) => (
            <HarnessTypeSectionBlock
              key={section.path}
              type={group.type}
              section={section}
              disabled={disabled}
              onOpen={onOpen}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
