import { REMOVAL_CONFIRM_COPY, type PlannedRemovals } from "../lib/ui-copy";
import { ConfirmDialog } from "./ConfirmDialog";

export function RiskyRemovalDialog({
  open,
  groups,
  busy,
  onKeep,
  onRemoveToo,
  onCancel,
}: {
  open: boolean;
  groups: PlannedRemovals | null;
  busy?: boolean;
  onKeep: () => void;
  onRemoveToo: () => void;
  onCancel: () => void;
}) {
  const modified = groups?.owned_modified ?? [];
  const unmanaged = groups?.unmanaged ?? [];
  return (
    <ConfirmDialog
      open={open}
      title={REMOVAL_CONFIRM_COPY.title}
      description={
        <div data-testid="risky-removal-dialog">
          <p className="muted">{REMOVAL_CONFIRM_COPY.description}</p>
          {modified.length > 0 ? (
            <>
              <p className="muted">{REMOVAL_CONFIRM_COPY.modifiedHeading}</p>
              <ul className="library-bulk-delete-list">
                {modified.map((path) => (
                  <li key={`mod:${path}`} className="mono">
                    {path}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {unmanaged.length > 0 ? (
            <>
              <p className="muted">{REMOVAL_CONFIRM_COPY.unmanagedHeading}</p>
              <ul className="library-bulk-delete-list">
                {unmanaged.map((path) => (
                  <li key={`unm:${path}`} className="mono">
                    {path}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      }
      confirmLabel={REMOVAL_CONFIRM_COPY.keepTheseFiles}
      secondaryLabel={REMOVAL_CONFIRM_COPY.removeThemToo}
      cancelLabel={REMOVAL_CONFIRM_COPY.cancel}
      confirmBusy={busy}
      secondaryBusy={busy}
      onConfirm={onKeep}
      onSecondary={onRemoveToo}
      onCancel={onCancel}
    />
  );
}
