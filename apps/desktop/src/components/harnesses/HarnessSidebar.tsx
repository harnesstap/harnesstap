import { ArrowLeftRight, Check, Pencil, Plus, ScanSearch, Trash2 } from "lucide-react";
import {
  canRemoveHarness,
  diskPresenceLabel,
  harnessResourceCount,
  KEEP_ONE_HARNESS_HINT,
  roleOf,
  type HarnessEntry,
  type HarnessId,
  type HarnessSelection,
} from "../../lib/harness-inventory";
import type { HarnessesBusy } from "../../state/harnesses-controller";
import { EmptyState } from "../EmptyState";
import { HarnessIcon } from "../HarnessIcons";
import { IconActionButton } from "../IconActionButton";
import { ButtonSpinner } from "../ButtonSpinner";

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
  onAdd: () => void;
  onDetect: () => void;
  onToggleEdit: () => void;
  /** Trash click; the workspace opens the confirm dialog. */
  onRemove: (id: HarnessId) => void;
  syncLabel: string;
  syncTitle: string;
  syncDisabled: boolean;
  syncHidden: boolean;
  syncBusy: boolean;
  syncHelper: string | null;
  syncError: string | null;
  onSync: () => void;
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
  onAdd,
  onDetect,
  onToggleEdit,
  onRemove,
  syncLabel,
  syncTitle,
  syncDisabled,
  syncHidden,
  syncBusy,
  syncHelper,
  syncError,
  onSync,
}: HarnessSidebarProps) {
  const working = busy.kind !== "idle";
  const showSkeleton = loading && rows.length === 0;

  return (
    <aside
      className="resource-filter-sidebar harness-list-sidebar"
      aria-label="Harness list"
    >
      <div className="resource-filter-section">
        <div className="harness-sidebar-actions">
          <IconActionButton
            label="Add harness"
            primary
            data-testid="add-harness"
            disabled={disabled || working}
            onClick={onAdd}
            icon={<Plus size={ICON_SIZE} aria-hidden />}
          />
          <IconActionButton
            label="Detect harnesses"
            data-testid="detect-harnesses"
            disabled={disabled || working}
            busy={busy.kind === "detecting"}
            onClick={onDetect}
            icon={<ScanSearch size={ICON_SIZE} aria-hidden />}
          />
          <IconActionButton
            label={editing ? "Done" : "Edit"}
            data-testid="edit-harnesses"
            aria-pressed={editing}
            disabled={disabled || (rows.length === 0 && !editing)}
            onClick={onToggleEdit}
            icon={
              editing
                ? <Check size={ICON_SIZE} aria-hidden />
                : <Pencil size={ICON_SIZE} aria-hidden />
            }
          />
        </div>
      </div>
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
        ) : rows.length === 0 ? (
          <EmptyState
            title="No harnesses set up."
            body="Detect the harnesses on this machine or add one."
            testId="harnesses-empty"
            action={{
              label: "Detect harnesses",
              primary: true,
              disabled: disabled || working,
              onClick: onDetect,
              icon: <ScanSearch size={ICON_SIZE} aria-hidden />,
            }}
          />
        ) : (
          <ul className="resources-list" aria-label="Harnesses">
            {rows.map((entry) => {
              const selected = selectedId === entry.id;
              const role = roleOf(selection, entry.id);
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
                        {role === "main" ? <span className="badge">main</span> : null}
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
      {syncHidden ? null : (
        <div className="rail-controls harness-sync-controls">
          {syncHelper ? (
            <p className="muted apply-helper" data-testid="sync-harnesses-helper">
              {syncHelper}
            </p>
          ) : null}
          {syncError ? (
            <p className="muted apply-helper harness-sync-error" data-testid="sync-harnesses-error">
              {syncError}
            </p>
          ) : null}
          <button
            className={["btn", "primary", "rail-apply-action", syncBusy ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            data-testid="sync-harnesses"
            onClick={onSync}
            disabled={syncDisabled || syncBusy}
            aria-busy={syncBusy}
            title={syncTitle}
          >
            {syncLabel}
            {syncBusy ? (
              <ButtonSpinner size={16} />
            ) : (
              <ArrowLeftRight size={16} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
