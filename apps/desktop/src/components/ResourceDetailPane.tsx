import { useEffect, useId, useRef, useState } from "react";
import {
  ResourceDetailBody,
  type ResourceDetailTarget,
} from "./ResourceDetailBody";
import { useOverlayLayer } from "../state/overlay-stack";

export type { ResourceDetailTarget };

export interface ResourceDetailPaneProps {
  open: boolean;
  target: ResourceDetailTarget | null;
  baseUrl: string | null;
  token: string | null;
  onClose: () => void;
  disabled?: boolean;
  onSuccess?: (message: string) => void;
  onLibraryChanged?: () => void;
  duplicatePluginNames?: ReadonlySet<string>;
}

export function ResourceDetailPane({
  open,
  target,
  baseUrl,
  token,
  onClose,
  disabled = false,
  onSuccess,
  onLibraryChanged,
  duplicatePluginNames,
}: ResourceDetailPaneProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [fieldEditing, setFieldEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nested confirms register their own layer above this one; field editors
  // handle Esc on the input, so the layer stays put while editing.
  const layerRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose,
    closeDisabled: busy || confirmOpen || fieldEditing,
    initialFocusRef: closeRef,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, target?.selector]);

  if (!open || !target) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop resource-detail-backdrop"
      role="presentation"
    >
      <div
        ref={layerRef}
        className="dialog resource-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <ResourceDetailBody
          chrome="dialog"
          target={target}
          baseUrl={baseUrl}
          token={token}
          disabled={disabled}
          titleId={titleId}
          closeRef={closeRef}
          onClose={onClose}
          onDeleted={onClose}
          onSuccess={onSuccess}
          onLibraryChanged={onLibraryChanged}
          onFieldEditingChange={setFieldEditing}
          onConfirmOpenChange={setConfirmOpen}
          onBusyChange={setBusy}
          duplicatePluginNames={duplicatePluginNames}
        />
      </div>
    </div>
  );
}
