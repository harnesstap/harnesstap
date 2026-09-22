import { UnfoldVertical } from "lucide-react";
import {
  visibleLocationRows,
  type HarnessLocation,
  type HarnessResourceRow,
} from "../../lib/harness-inventory";
import type { ResourceHoverModel } from "../../lib/resource-hover";
import { IconActionButton } from "../IconActionButton";
import { TypeIcon } from "../TypeIcon";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
} from "../ui/resource-row";

const ICON_SIZE = 16;

export interface HarnessLocationPanelProps {
  location: HarnessLocation;
  expanded: boolean;
  disabled: boolean;
  onShowAll: () => void;
  onOpen: (row: HarnessResourceRow) => void;
}

function rowKey(row: HarnessResourceRow): string {
  return row.id || `${row.type}:${row.name}:${row.source}`;
}

function hoverModel(row: HarnessResourceRow): ResourceHoverModel {
  return {
    type: row.type,
    name: row.name,
    path: row.source,
    harnessIds: [],
    extra: [],
  };
}

/** One bordered section per registry path. Files are never deleted from here. */
export function HarnessLocationPanel({
  location,
  expanded,
  disabled,
  onShowAll,
  onOpen,
}: HarnessLocationPanelProps) {
  const rows = visibleLocationRows(location, expanded);
  const total = location.resources.length;

  return (
    <section
      className="harness-block harness-location"
      aria-label={location.path}
      data-testid="harness-location"
    >
      <div className="harness-header harness-location-header">
        <span className="harness-location-path mono">{location.path}</span>
        <span className="harness-location-meta muted">
          <span className="harness-location-surfaces">{location.surfaces.join(", ")}</span>
          <span className="badge pill inventory-section-count">{total}</span>
          {!location.onDisk ? (
            <span className="harness-location-absent">not on disk</span>
          ) : null}
        </span>
      </div>
      <div className="harness-body harness-location-body">
        {total === 0 ? (
          <p className="muted harness-location-empty">Nothing here yet.</p>
        ) : (
          <ul className="resources-list harness-location-rows">
            {rows.map((row) => (
              <li className="resources-list-item" key={rowKey(row)}>
                <ResourceRowRoot
                  hover={hoverModel(row)}
                  className="harness-resource-row"
                  disabled={disabled}
                  testId={`harness-resource-${row.name}`}
                  onActivate={() => onOpen(row)}
                >
                  <ResourceRowLeading>
                    <TypeIcon type={row.type} />
                  </ResourceRowLeading>
                  <ResourceRowIdentity label={row.name}>
                    <ResourceRowDescription>{row.source}</ResourceRowDescription>
                  </ResourceRowIdentity>
                </ResourceRowRoot>
              </li>
            ))}
          </ul>
        )}
        {rows.length < total ? (
          <div className="list-truncation-controls muted">
            <span>
              Showing {rows.length} of {total}
            </span>
            <span aria-hidden className="list-truncation-sep">
              |
            </span>
            <IconActionButton
              label="Show all"
              disabled={disabled}
              onClick={onShowAll}
              spinnerSize={ICON_SIZE}
              icon={<UnfoldVertical size={ICON_SIZE} strokeWidth={2} aria-hidden />}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
