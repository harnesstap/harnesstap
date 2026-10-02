import { Download, ExternalLink } from "lucide-react";
import {
  groupHarnessLocationsByType,
  harnessDuplicatePluginNames,
  harnessResourceBadgeLabel,
  harnessResourceDisplayName,
  type HarnessEntry,
  type HarnessLocation,
  type HarnessResourceRow,
  type HarnessTypeSection,
} from "../../lib/harness-inventory";
import {
  HARNESS_PULL_ALL_EMPTY_TOOLTIP,
  HARNESS_PULL_ALL_LABEL,
  HARNESS_PULL_ALL_TOOLTIP,
  harnessPluginPullTargets,
  pluginRowsFromTypeGroup,
  type HarnessPluginPullTarget,
} from "../../lib/harness-plugin-pull";
import { HARNESS_OPEN_LOCATION_LABEL } from "../../lib/harness-location-open";
import {
  hookHoverExtras,
  listRowHoverPath,
  type ResourceHoverModel,
} from "../../lib/resource-hover";
import { resourceTypeTabLabel } from "../../lib/resource-type-tabs";
import { ChromeTooltip } from "../ChromeTooltip";
import { HarnessIcon } from "../HarnessIcons";
import { IconActionButton } from "../IconActionButton";
import { TypeIcon } from "../TypeIcon";
import { ResourceHoverCard } from "../ui/resource-hover-card";

const TITLE_ICON_SIZE = 16;

export interface HarnessInventoryListProps {
  entry: HarnessEntry;
  locations: readonly HarnessLocation[];
  disabled: boolean;
  pullAllBusy?: boolean;
  onOpen: (row: HarnessResourceRow) => void;
  onOpenLocation?: (path: string) => void;
  onPullAllPlugins?: (targets: readonly HarnessPluginPullTarget[]) => void;
}

function rowKey(row: HarnessResourceRow): string {
  return row.id || `${row.type}:${row.name}:${row.source}`;
}

function badgeHover(
  row: HarnessResourceRow,
  duplicateNames?: ReadonlySet<string>,
): ResourceHoverModel {
  const name = harnessResourceDisplayName(row, duplicateNames);
  return {
    type: row.type,
    name,
    showName: true,
    path: listRowHoverPath(row),
    harnessIds: [],
    extra: hookHoverExtras(row),
  };
}

function ResourceBadge({
  row,
  disabled,
  onOpen,
  duplicateNames,
}: {
  row: HarnessResourceRow;
  disabled: boolean;
  onOpen: (row: HarnessResourceRow) => void;
  duplicateNames?: ReadonlySet<string>;
}) {
  const label = harnessResourceBadgeLabel(row, duplicateNames);
  const fullName = harnessResourceDisplayName(row, duplicateNames);
  const clickable = Boolean(row.id) && !disabled;
  const className = "resource-type-tab harness-resource-badge";

  const face = clickable ? (
    <button
      type="button"
      className={className}
      disabled={disabled}
      data-testid={`harness-resource-${fullName}`}
      aria-label={fullName}
      onClick={() => onOpen(row)}
    >
      {label}
    </button>
  ) : (
    <span
      className={`${className} is-static`}
      data-testid={`harness-resource-${fullName}`}
      aria-label={fullName}
    >
      {label}
    </span>
  );

  return (
    <ResourceHoverCard model={badgeHover(row, duplicateNames)} disabled={disabled}>
      {face}
    </ResourceHoverCard>
  );
}

function HarnessTypeSectionBlock({
  type,
  section,
  disabled,
  onOpen,
  onOpenLocation,
  duplicateNames,
}: {
  type: string;
  section: HarnessTypeSection;
  disabled: boolean;
  onOpen: (row: HarnessResourceRow) => void;
  onOpenLocation?: (path: string) => void;
  duplicateNames?: ReadonlySet<string>;
}) {
  const openLocation = onOpenLocation;
  const canOpenLocation = Boolean(openLocation) && section.onDisk;
  return (
    <section
      className="harness-type-section"
      aria-label={`${section.owner.name} ${resourceTypeTabLabel(type)}`}
      data-testid="harness-location"
      data-path={section.path}
    >
      <div className="harness-type-section-title-row">
        <ChromeTooltip content={section.path}>
          <span className="harness-type-section-title">
            <HarnessIcon id={section.owner.iconId} size={TITLE_ICON_SIZE} tooltip={false} />
            <span>{section.owner.name}</span>
          </span>
        </ChromeTooltip>
        {openLocation ? (
          <IconActionButton
            data-testid="harness-open-location"
            label={HARNESS_OPEN_LOCATION_LABEL}
            title={section.path}
            disabled={disabled || !canOpenLocation}
            onClick={() => openLocation(section.path)}
            icon={<ExternalLink size={TITLE_ICON_SIZE} aria-hidden />}
          />
        ) : null}
      </div>
      <div className="harness-resource-badges">
        {section.resources.map((row) => (
          <ResourceBadge
            key={rowKey(row)}
            row={row}
            disabled={disabled}
            onOpen={onOpen}
            duplicateNames={duplicateNames}
          />
        ))}
      </div>
    </section>
  );
}

export function HarnessInventoryList({
  entry,
  locations,
  disabled,
  pullAllBusy = false,
  onOpen,
  onOpenLocation,
  onPullAllPlugins,
}: HarnessInventoryListProps) {
  const groups = groupHarnessLocationsByType(entry, locations)
    .map((group) => ({
      ...group,
      sections: group.sections.filter((section) => section.resources.length > 0),
    }))
    .filter((group) => group.sections.length > 0);
  const duplicateNames = harnessDuplicatePluginNames(entry.locations);

  return (
    <div className="harness-type-list">
      {groups.map((group) => {
        const pullTargets =
          group.type === "plugin"
            ? harnessPluginPullTargets(pluginRowsFromTypeGroup(group), duplicateNames)
            : [];
        const pullAll = onPullAllPlugins;
        const showPullAll = group.type === "plugin" && Boolean(pullAll);
        const pullDisabled = disabled || pullAllBusy || pullTargets.length === 0;
        return (
          <section
            key={group.type}
            className="harness-type-group"
            aria-label={resourceTypeTabLabel(group.type)}
            data-testid="harness-type-group"
            data-type={group.type}
          >
            <div className="harness-type-heading-row">
              <h3 className="harness-type-heading">
                <TypeIcon type={group.type} />
                <span>{resourceTypeTabLabel(group.type)}</span>
              </h3>
              {showPullAll && pullAll ? (
                <IconActionButton
                  data-testid="harness-pull-all-plugins"
                  showLabel
                  iconAfterLabel
                  busy={pullAllBusy}
                  spinnerSize={TITLE_ICON_SIZE}
                  disabled={pullDisabled}
                  label={HARNESS_PULL_ALL_LABEL}
                  title={
                    pullTargets.length === 0
                      ? HARNESS_PULL_ALL_EMPTY_TOOLTIP
                      : HARNESS_PULL_ALL_TOOLTIP
                  }
                  onClick={() => pullAll(pullTargets)}
                  icon={<Download size={TITLE_ICON_SIZE} aria-hidden />}
                />
              ) : null}
            </div>
            {group.sections.map((section) => (
              <HarnessTypeSectionBlock
                key={section.path}
                type={group.type}
                section={section}
                disabled={disabled}
                onOpen={onOpen}
                onOpenLocation={onOpenLocation}
                duplicateNames={duplicateNames}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
