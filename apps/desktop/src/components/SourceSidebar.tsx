import { useEffect, useState } from "react";
import { AlertTriangle, FilterX, Unlink, Unplug } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { sourcesSidebarChangeAction } from "../lib/sources-pane";
import { ButtonSpinner } from "./ButtonSpinner";
import { Banner } from "./shell/Banner";
import {
  groupSourceRows,
  isSourcesFilterActive,
  sourceCheckState,
  sourceChildChecked,
  type SourceCheckState,
  type SourceRow,
} from "../lib/sources-sidebar";
import { noSpellcheckProps } from "../lib/no-spellcheck";
import { ChromeTooltip } from "./ChromeTooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconActionButton } from "./IconActionButton";

const ACTION_ICON_SIZE = 16;

type PendingConfirm =
  | { kind: "org"; org: string }
  | { kind: "catalog"; selector: string };

export interface SourceSidebarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  notInLibrary: boolean;
  onNotInLibraryChange: (notInLibrary: boolean) => void;
  rows: SourceRow[];
  checkedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  disabled?: boolean;
  busy?: boolean;
  sourceErrors?: Readonly<Record<string, string>>;
  originCheckError?: string | null;
  onRetryOriginCheck?: () => void;
  refreshing?: boolean;
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
  notInLibrary,
  onNotInLibraryChange,
  rows,
  checkedIds,
  onToggle,
  onToggleAll,
  disabled = false,
  busy = false,
  sourceErrors,
  originCheckError,
  onRetryOriginCheck,
  refreshing = false,
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
  const dirty = isSourcesFilterActive(
    query,
    checkedIds,
    rows,
    notInLibrary,
  );
  const checkState = sourceCheckState(checkedIds, rows);
  const masterChecked = sourceMasterChecked(checkState);

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
    <aside className="resource-filter-sidebar" aria-label="Discover filters">
      <div className="resource-filter-section">
        <div className="resource-filter-search-row">
          <input
            className="resources-panel-filter"
            type="search"
            placeholder="Search to add"
            aria-label="Search to add"
            value={query}
            data-workspace-filter=""
            onChange={(event) => {
              const next = event.target.value;
              applySidebarChange(() => onQueryChange(next));
            }}
            disabled={controlsDisabled}
            {...noSpellcheckProps}
          />
          {refreshing ? (
            <span
              className="sources-sidebar-refresh"
              aria-label="Refreshing sources"
              role="status"
            >
              <ButtonSpinner size={14} />
            </span>
          ) : null}
          <IconActionButton
            className="resource-filter-clear"
            label="Clear filters"
            disabled={controlsDisabled || !dirty}
            onClick={() => applySidebarChange(() => onClear())}
            icon={<FilterX size={ACTION_ICON_SIZE} aria-hidden />}
          />
        </div>
        <div className="source-row">
          <div className="source-row-check">
            <Checkbox
              id="source-not-in-library"
              checked={notInLibrary}
              disabled={controlsDisabled}
              onCheckedChange={(checked) =>
                applySidebarChange(() =>
                  onNotInLibraryChange(checked === true),
                )
              }
            />
            <Label htmlFor="source-not-in-library" className="font-normal">
              Not in my library
            </Label>
          </div>
        </div>
      </div>
      {originCheckError ? (
        <Banner
          tone="error"
          message={originCheckError}
          onRetry={onRetryOriginCheck}
          testId="sources-origin-check-error"
        />
      ) : null}
      {rows.length > 0 ? (
        <div className="resource-filter-section source-row-list source-tree">
          <div className="source-row source-master-row">
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
          className="resource-filter-section source-row-list source-tree-children"
        >
          <span className="resource-filter-section-label">{section.label}</span>
          {section.rows.map((row) => (
            <SourceRowItem
              key={row.id}
              row={row}
              checked={sourceChildChecked(
                checkState,
                checkedIds.includes(row.id),
              )}
              disabled={controlsDisabled}
              sourceError={sourceErrors?.[row.id]}
              onToggle={() => applySidebarChange(() => onToggle(row.id))}
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
  sourceError,
  onToggle,
  onRequestDisconnectOrg,
  onRequestUnregisterCatalog,
}: {
  row: SourceRow;
  checked: boolean;
  disabled: boolean;
  sourceError?: string;
  onToggle: () => void;
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
        {sourceError ? (
          <ChromeTooltip content={sourceError}>
            <span
              className="source-row-error-mark"
              data-testid={`source-error-${row.id}`}
              role="img"
              aria-label={sourceError}
            >
              <AlertTriangle size={ACTION_ICON_SIZE} aria-hidden />
            </span>
          </ChromeTooltip>
        ) : null}
      </div>
      <SourceRowActions
        row={row}
        disabled={disabled}
        onRequestDisconnectOrg={onRequestDisconnectOrg}
        onRequestUnregisterCatalog={onRequestUnregisterCatalog}
      />
    </div>
  );
}

function SourceRowActions({
  row,
  disabled,
  onRequestDisconnectOrg,
  onRequestUnregisterCatalog,
}: {
  row: SourceRow;
  disabled: boolean;
  onRequestDisconnectOrg: (org: string) => void;
  onRequestUnregisterCatalog: (selector: string) => void;
}) {
  switch (row.kind) {
    case "local":
    case "marketplace":
      return null;
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
