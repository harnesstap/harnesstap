import { Trash2 } from "lucide-react";
import {
  canRemoveHarness,
  diskPresenceLabel,
  harnessResourceCount,
  KEEP_ONE_HARNESS_HINT,
  type HarnessEntry,
  type HarnessId,
  type HarnessSelection,
} from "../../lib/harness-inventory";
import type { HarnessesBusy } from "../../state/harnesses-controller";
import { HarnessIcon } from "../HarnessIcons";
import { IconActionButton } from "../IconActionButton";

const ICON_SIZE = 16;
const SKELETON_COUNT = 4;

export interface HarnessSidebarProps {
  rows: readonly HarnessEntry[];
  selection: HarnessSelection | null;
  selectedId: HarnessId | null;
  editing: boolean;
  loading: boolean;
  disabled: boolean;
  busy: HarnessesBusy;
  onSelect: (id: HarnessId) => void;
  /** Trash click; the workspace opens the confirm dialog. */
  onRemove: (id: HarnessId) => void;
}

function rowSubtitle(entry: HarnessEntry): string {
  const count = harnessResourceCount(entry);
  const resources = `${count} resource${count === 1 ? "" : "s"}`;
  return entry.disk === "detected"
    ? resources
    : `${resources} · ${diskPresenceLabel(entry.disk)}`;
}

export function HarnessSidebar({
  rows,
  selection,
  selectedId,
  editing,
  loading,
  disabled,
  busy,
  onSelect,
  onRemove,
}: HarnessSidebarProps) {
  const working = busy.kind !== "idle";
  const showSkeleton = loading && rows.length === 0;

  return (
    <aside
      className="resource-filter-sidebar harness-list-sidebar"
      aria-label="Harness list"
    >
      <div className="harness-list-scroll">
        {showSkeleton ? (
          <ul className="resources-list" aria-busy="true" aria-label="Loading harnesses">
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <li className="resources-list-item" key={`harness-skel-${index}`}>
                <div className="harness-skeleton-row">
                  <div className="m-skeleton harness-skeleton-line" />
                  <div className="m-skeleton harness-skeleton-line is-short" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? null : (
          <ul className="resources-list" aria-label="Harnesses">
            {rows.map((entry) => {
              const selected = selectedId === entry.id;
              const removable = canRemoveHarness(selection, entry.id);
              return (
                <li className="resources-list-item" key={entry.id}>
                  <div className={["harness-list-row", selected ? "is-selected" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  >
                    <button
                      type="button"
                      className={["resources-list-env", selected ? "is-selected" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={disabled}
                      aria-current={selected ? "true" : undefined}
                      data-testid="harness-row"
                      onClick={() => onSelect(entry.id)}
                    >
                      <span className="resources-list-name harness-list-name">
                        <HarnessIcon id={entry.id} tooltip={false} />
                        {entry.name}
                      </span>
                      <span className="resources-list-desc muted">{rowSubtitle(entry)}</span>
                    </button>
                    <span className="inventory-row-remove-slot">
                      {editing ? (
                        <IconActionButton
                          className="harness-remove-action"
                          label={`Remove ${entry.name}`}
                          title={removable.ok ? "Remove" : KEEP_ONE_HARNESS_HINT}
                          disabled={disabled || working || !removable.ok}
                          onClick={() => onRemove(entry.id)}
                          icon={<Trash2 size={ICON_SIZE} aria-hidden />}
                        />
                      ) : (
                        <span className="inventory-row-remove-placeholder" aria-hidden />
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
