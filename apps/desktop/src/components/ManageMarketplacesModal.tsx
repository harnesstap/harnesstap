import { useEffect, useId, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { shouldCloseDialogOnBackdrop } from "../lib/dialog-dismiss";
import type { PluginMarketplaceEntry } from "../lib/types";
import { useOverlayLayer } from "../state/overlay-stack";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconActionButton } from "./IconActionButton";
import { Presence } from "./motion/Presence";
import { motionClass } from "./motion/motion-utils";

const ACTION_ICON_SIZE = 16;

export interface ManageMarketplacesModalProps {
  open: boolean;
  marketplaces: PluginMarketplaceEntry[];
  busy?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onEdit: (entry: PluginMarketplaceEntry) => void;
  onRemove: (name: string) => void;
}

export function ManageMarketplacesModal({
  open,
  marketplaces,
  busy = false,
  disabled = false,
  onClose,
  onEdit,
  onRemove,
}: ManageMarketplacesModalProps) {
  const titleId = useId();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const controlsDisabled = disabled || busy;
  const confirmOpen = pendingName !== null;
  const layerRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose,
    closeDisabled: busy || confirmOpen,
  });

  useEffect(() => {
    if (!open) {
      setPendingName(null);
    }
  }, [open]);

  const close = () => {
    if (busy || confirmOpen) {
      return;
    }
    onClose();
  };

  return (
    <>
      <Presence
        open={open}
        enter="m-scrim-in"
        exit="m-scrim-out"
        className="dialog-backdrop"
        role="presentation"
        onClick={(event) => {
          if (
            shouldCloseDialogOnBackdrop(
              event.target,
              event.currentTarget,
              busy || confirmOpen,
            )
          ) {
            onClose();
          }
        }}
      >
        {(state) => (
          <div
            ref={layerRef}
            className={motionClass(
              "dialog manage-marketplaces-dialog",
              "m-rise",
              state,
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="manage-marketplaces-modal"
          >
            <div className="manage-marketplaces-header">
              <h2 id={titleId}>Marketplaces</h2>
              <IconActionButton
                label="Close"
                disabled={controlsDisabled || confirmOpen}
                onClick={close}
                icon={<X size={ACTION_ICON_SIZE} aria-hidden />}
              />
            </div>
            {marketplaces.length === 0 ? (
              <p className="muted manage-marketplaces-empty">
                No marketplaces yet. Add one from Discover.
              </p>
            ) : (
              <ul className="marketplace-list" aria-label="Marketplaces">
                {marketplaces.map((entry) => (
                  <li key={entry.name} data-testid={`manage-marketplace-row-${entry.name}`}>
                    <div className="manage-marketplaces-row">
                      <div className="manage-marketplaces-copy">
                        <span className="marketplace-row-name">{entry.name}</span>
                        {entry.url ? (
                          <span className="marketplace-row-url muted">{entry.url}</span>
                        ) : null}
                      </div>
                      <div className="source-row-actions">
                        <IconActionButton
                          label="Edit"
                          disabled={controlsDisabled}
                          onClick={() => onEdit(entry)}
                          icon={<Pencil size={ACTION_ICON_SIZE} aria-hidden />}
                        />
                        <IconActionButton
                          label="Remove"
                          disabled={controlsDisabled}
                          onClick={() => setPendingName(entry.name)}
                          icon={<Trash2 size={ACTION_ICON_SIZE} aria-hidden />}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Presence>
      <ConfirmDialog
        open={pendingName !== null}
        title="Remove marketplace?"
        description={
          pendingName
            ? `Removing ${pendingName} unregisters this source. Plugins already pinned stay installed.`
            : ""
        }
        confirmLabel="Remove marketplace"
        confirmBusy={busy}
        tone="destructive"
        onConfirm={() => {
          if (!pendingName || busy) {
            return;
          }
          const name = pendingName;
          setPendingName(null);
          onRemove(name);
        }}
        onCancel={() => {
          if (!busy) {
            setPendingName(null);
          }
        }}
      />
    </>
  );
}
