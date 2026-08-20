import { useState } from "react";
import { FilterX } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SourceRow } from "../lib/sources-sidebar";
import { ConfirmDialog } from "./ConfirmDialog";

const ACTION_ICON_SIZE = 16;

type PendingConfirm =
  | { kind: "marketplace"; name: string }
  | { kind: "org"; org: string }
  | { kind: "catalog"; selector: string };

export interface SourceSidebarProps {
  query: string;
  onQueryChange: (query: string) => void;
  rows: SourceRow[];
  checkedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onEditMarketplace: (name: string) => void;
  onRemoveMarketplace: (name: string) => void;
  onDisconnectOrg: (org: string) => void;
  onUnregisterCatalog: (selector: string) => void;
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

export function SourceSidebar({
  query,
  onQueryChange,
  rows,
  checkedIds,
  onToggle,
  disabled = false,
  busy = false,
  error,
  onEditMarketplace,
  onRemoveMarketplace,
  onDisconnectOrg,
  onUnregisterCatalog,
}: SourceSidebarProps) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const controlsDisabled = disabled || busy;

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
            onChange={(event) => onQueryChange(event.target.value)}
            disabled={controlsDisabled}
          />
          <button
            type="button"
            className="icon-action resource-filter-clear"
            aria-label="Clear search"
            title="Clear search"
            disabled={controlsDisabled || query.trim() === ""}
            onClick={() => onQueryChange("")}
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
      <div className="resource-filter-section source-row-list">
        {rows.map((row) => (
          <SourceRowItem
            key={row.id}
            row={row}
            checked={checkedIds.includes(row.id)}
            disabled={controlsDisabled}
            onToggle={() => onToggle(row.id)}
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
      return (
        <div className="source-row-actions">
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => onEditMarketplace(row.label)}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => onRequestRemoveMarketplace(row.label)}
          >
            Remove
          </button>
        </div>
      );
    case "cloud-org":
      if (row.disconnectForbidden || !row.removable) {
        return null;
      }
      return (
        <div className="source-row-actions">
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => onRequestDisconnectOrg(row.label)}
          >
            Disconnect
          </button>
        </div>
      );
    case "cloud-catalog":
      return (
        <div className="source-row-actions">
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => onRequestUnregisterCatalog(row.label)}
          >
            Unregister
          </button>
        </div>
      );
    default: {
      const neverKind: never = row.kind;
      return neverKind;
    }
  }
}
