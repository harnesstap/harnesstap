import { useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { harnessSupportsLabel, type HarnessEntry, type HarnessId } from "../../lib/harness-inventory";
import { visibleHarnesses } from "../../lib/harness-settings-form";
import { useOverlayLayer } from "../../state/overlay-stack";
import { HarnessIcon } from "../HarnessIcons";
import { IconActionButton } from "../IconActionButton";
import { Presence } from "../motion/Presence";
import { motionClass } from "../motion/motion-utils";

const ICON_SIZE = 16;
const ROW_ICON_SIZE = 18;

export interface AddHarnessModalProps {
  open: boolean;
  /** `availableHarnesses(inventory)`: catalog minus configured, detected first, then name. */
  rows: readonly HarnessEntry[];
  busy: boolean;
  disabled?: boolean;
  onClose: () => void;
  /** Single pick, immediate add. */
  onPick: (id: HarnessId) => void;
}

export function AddHarnessModal({
  open,
  rows,
  busy,
  disabled = false,
  onClose,
  onPick,
}: AddHarnessModalProps) {
  const titleId = useId();
  const showAllId = useId();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowAll(false);
    }
  }, [open]);

  const layerRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose,
    closeDisabled: busy,
  });

  // Detected harnesses stay listed even when unsupported, like a saved alias would in Settings.
  const visible = useMemo(
    () =>
      visibleHarnesses([...rows], {
        showAll,
        selectedIds: rows.filter((entry) => entry.disk === "detected").map((entry) => entry.id),
      }),
    [rows, showAll],
  );
  const hiddenCount = rows.length - visible.length;

  return (
    <Presence
      open={open}
      enter="m-scrim-in"
      exit="m-scrim-out"
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      {(state) => (
        <div
          ref={layerRef}
          className={motionClass("dialog resource-type-dialog add-harness-dialog", "m-rise", state)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="add-harness-modal"
        >
          <div className="resource-type-header">
            <h2 id={titleId}>Add harness</h2>
            <div className="resource-type-header-actions">
              <IconActionButton
                data-testid="add-harness-close"
                label="Close"
                disabled={busy}
                onClick={onClose}
                icon={<X size={ICON_SIZE} aria-hidden />}
              />
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="muted add-harness-empty">Every harness is already set up.</p>
          ) : (
            <ul className="resource-type-list" aria-label="Available harnesses">
              {visible.map((entry) => {
                const meta = harnessSupportsLabel(entry.supports);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="resource-type-option"
                      data-testid={`add-harness-option-${entry.id}`}
                      disabled={disabled || busy}
                      onClick={() => onPick(entry.id)}
                    >
                      <HarnessIcon id={entry.id} size={ROW_ICON_SIZE} tooltip={false} />
                      <span className="resource-type-copy">
                        <span className="resource-type-title">{entry.name}</span>
                        {meta ? (
                          <span className="resource-type-description muted">{meta}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hiddenCount > 0 || showAll ? (
            <div className="switch-after-create add-harness-show-all flex items-center gap-2">
              <Switch
                id={showAllId}
                checked={showAll}
                onCheckedChange={setShowAll}
                disabled={busy}
              />
              <Label htmlFor={showAllId}>Show all harnesses</Label>
            </div>
          ) : null}
        </div>
      )}
    </Presence>
  );
}
