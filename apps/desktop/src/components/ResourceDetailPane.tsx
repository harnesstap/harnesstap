import { useEffect, useId, useRef, useState } from "react";
import {
  ResourceDetailBody,
  type ResourceDetailTarget,
} from "./ResourceDetailBody";

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
}: ResourceDetailPaneProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [fieldEditing, setFieldEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (busy || confirmOpen || fieldEditing) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy, confirmOpen, fieldEditing]);

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
        />
      </div>
    </div>
  );
}
