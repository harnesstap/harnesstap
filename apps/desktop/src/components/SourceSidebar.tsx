import { useEffect, useState } from "react";
import { FilterX, Pencil, Trash2, Unlink, Unplug } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { sourcesSidebarChangeAction } from "../lib/sources-pane";
import {
  groupSourceRows,
  isSourcesFilterActive,
  sourceCheckState,
  type SourceCheckState,
  type SourceRow,
} from "../lib/sources-sidebar";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconActionButton } from "./IconActionButton";

const ACTION_ICON_SIZE = 16;

type PendingConfirm =
  | { kind: "marketplace"; name: string }
  | { kind: "org"; org: string }
  | { kind: "catalog"; selector: string };

export interface SourceSidebarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  rows: SourceRow[];
  checkedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  disabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onEditMarketplace: (name: string) => void;
  onRemoveMarketplace: (name: string) => void;
  onDisconnectOrg: (org: string) => void;
  onUnregisterCatalog: (selector: string) => void;
  onConfirmOpenChange?: (open: boolean) => void;
}

function confirmCopy(pending: PendingConfirm): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  switch (pending.kind) {
    case "marketplace":
      return {
        title: "Remove marketplace?",
        description: `Removing ${pending.name} unregisters this source. Plugins already pinned stay installed.`,
        confirmLabel: "Remove marketplace",
      };
    case "org":
      return {
        title: "Disconnect org?",
        description: `Disconnect ${pending.org} from Cloud search. You can connect it again later.`,
        confirmLabel: "Disconnect",
      };
    case "catalog":
      return {
        title: "Unregister catalog?",
        description: `Unregister ${pending.selector}. Profiles that publish to all registered catalogs will no longer include it.`,
        confirmLabel: "Unregister",
      };
    default: {
      const neverPending: never = pending;
      return neverPending;
    }
  }
}

function sourceMasterChecked(
  state: SourceCheckState,
): boolean | "indeterminate" {
  switch (state) {
    case "all":
      return true;
    case "none":
      return false;
    case "mixed":
      return "indeterminate";
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

export function SourceSidebar({
  query,
  onQueryChange,
  onClear,
  rows,
  checkedIds,
  onToggle,
  onToggleAll,
  disabled = false,
  busy = false,
  error,
  onEditMarketplace,
  onRemoveMarketplace,
  onDisconnectOrg,
  onUnregisterCatalog,
  onConfirmOpenChange,
}: SourceSidebarProps) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmOpen = pending !== null;
  useEffect(() => {
    onConfirmOpenChange?.(confirmOpen);
  }, [confirmOpen, onConfirmOpenChange]);
  const sidebarChange = sourcesSidebarChangeAction({ busy, confirmOpen });
  const controlsDisabled = disabled || sidebarChange === "block";
  const dirty = isSourcesFilterActive(query, checkedIds, rows);
  const masterChecked = sourceMasterChecked(sourceCheckState(checkedIds, rows));

  const applySidebarChange = (apply: () => void): void => {
    if (sourcesSidebarChangeAction({ busy, confirmOpen }) === "block") {
      return;
    }
    apply();
  };

  const onConfirm = () => {
    if (!pending || busy) {
      return;
    }
    switch (pending.kind) {
      case "marketplace":
        onRemoveMarketplace(pending.name);
        break;
      case "org":
        onDisconnectOrg(pending.org);
        break;
      case "catalog":
        onUnregisterCatalog(pending.selector);
        break;
      default: {
        const neverPending: never = pending;
        return neverPending;
      }
    }
    setPending(null);
  };

  return (
    <aside className="resource-filter-sidebar" aria-label="Sources">
      <div className="resource-filter-section">
        <div className="resource-filter-search-row">
          <input
            className="resources-panel-filter"
            type="search"
            placeholder="Search sources"
            aria-label="Search sources"
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              applySidebarChange(() => onQueryChange(next));
            }}
            disabled={controlsDisabled}
          />
          <button
            type="button"
            className="icon-action resource-filter-clear"
            aria-label="Clear filters"
            title="Clear filters"
            disabled={controlsDisabled || !dirty}
            onClick={() => applySidebarChange(() => onClear())}
          >
            <FilterX size={ACTION_ICON_SIZE} aria-hidden />
          </button>
        </div>
      </div>
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="resource-filter-section source-row-list">
          <div className="source-row">
            <div className="source-row-check">
              <Checkbox
                id="source-all"
                checked={masterChecked}
                disabled={controlsDisabled}
                onCheckedChange={() =>
                  applySidebarChange(() => onToggleAll())
                }
              />
              <Label htmlFor="source-all" className="font-normal">
                All sources
              </Label>
            </div>
          </div>
        </div>
      ) : null}
      {groupSourceRows(rows).map((section) => (
        <div
          key={section.id}
          className="resource-filter-section source-row-list"
        >
          <span className="resource-filter-section-label">{section.label}</span>
          {section.rows.map((row) => (
            <SourceRowItem
              key={row.id}
              row={row}
              checked={checkedIds.includes(row.id)}
              disabled={controlsDisabled}
              onToggle={() => applySidebarChange(() => onToggle(row.id))}
              onEditMarketplace={onEditMarketplace}
              onRequestRemoveMarketplace={(name) =>
                setPending({ kind: "marketplace", name })
              }
              onRequestDisconnectOrg={(org) => setPending({ kind: "org", org })}
              onRequestUnregisterCatalog={(selector) =>
                setPending({ kind: "catalog", selector })
              }
            />
          ))}
        </div>
      ))}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? confirmCopy(pending).title : ""}
        description={pending ? confirmCopy(pending).description : ""}
        confirmLabel={pending ? confirmCopy(pending).confirmLabel : "Continue"}
        confirmBusy={busy}
        onConfirm={onConfirm}
        onCancel={() => {
          if (!busy) {
            setPending(null);
          }
        }}
      />
    </aside>
  );
}

function SourceRowItem({
  row,
  checked,
  disabled,
  onToggle,
  onEditMarketplace,
  onRequestRemoveMarketplace,
  onRequestDisconnectOrg,
  onRequestUnregisterCatalog,
}: {
  row: SourceRow;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onEditMarketplace: (name: string) => void;
  onRequestRemoveMarketplace: (name: string) => void;
  onRequestDisconnectOrg: (org: string) => void;
  onRequestUnregisterCatalog: (selector: string) => void;
}) {
  return (
    <div className="source-row">
      <div className="source-row-check">
        <Checkbox
          id={`source-${row.id}`}
          checked={checked}
          disabled={disabled}
          onCheckedChange={() => onToggle()}
        />
        <Label htmlFor={`source-${row.id}`} className="font-normal">
          {row.label}
        </Label>
      </div>
      <SourceRowActions
        row={row}
        disabled={disabled}
        onEditMarketplace={onEditMarketplace}
        onRequestRemoveMarketplace={onRequestRemoveMarketplace}
        onRequestDisconnectOrg={onRequestDisconnectOrg}
        onRequestUnregisterCatalog={onRequestUnregisterCatalog}
      />
    </div>
  );
}

function SourceRowActions({
  row,
  disabled,
  onEditMarketplace,
  onRequestRemoveMarketplace,
  onRequestDisconnectOrg,
  onRequestUnregisterCatalog,
}: {
  row: SourceRow;
  disabled: boolean;
  onEditMarketplace: (name: string) => void;
  onRequestRemoveMarketplace: (name: string) => void;
  onRequestDisconnectOrg: (org: string) => void;
  onRequestUnregisterCatalog: (selector: string) => void;
}) {
  switch (row.kind) {
    case "local":
      return null;
    case "marketplace":
      if (!row.removable) {
        return null;
      }
      return (
        <div className="source-row-actions">
          <IconActionButton
            label="Edit"
            disabled={disabled}
            onClick={() => onEditMarketplace(row.label)}
            icon={<Pencil size={ACTION_ICON_SIZE} aria-hidden />}
          />
          <IconActionButton
            label="Remove"
            disabled={disabled}
            onClick={() => onRequestRemoveMarketplace(row.label)}
            icon={<Trash2 size={ACTION_ICON_SIZE} aria-hidden />}
          />
        </div>
      );
    case "cloud-org":
      if (row.disconnectForbidden || !row.removable) {
        return null;
      }
      return (
        <div className="source-row-actions">
          <IconActionButton
            label="Disconnect"
            disabled={disabled}
            onClick={() => onRequestDisconnectOrg(row.label)}
            icon={<Unplug size={ACTION_ICON_SIZE} aria-hidden />}
          />
        </div>
      );
    case "cloud-catalog":
      return (
        <div className="source-row-actions">
          <IconActionButton
            label="Unregister"
            disabled={disabled}
            onClick={() => onRequestUnregisterCatalog(row.label)}
            icon={<Unlink size={ACTION_ICON_SIZE} aria-hidden />}
          />
        </div>
      );
    default: {
      const neverKind: never = row.kind;
      return neverKind;
    }
  }
}
