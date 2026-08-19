import { useEffect, useRef } from "react";

export function shouldCloseDialogOnKey(key: string, closeDisabled = false): boolean {
  return !closeDisabled && key === "Escape";
}

export function shouldCloseDialogOnBackdrop(
  target: EventTarget | null,
  currentTarget: EventTarget,
  closeDisabled = false,
): boolean {
  return !closeDisabled && target === currentTarget;
}

export function useDialogDismiss(
  open: boolean,
  onClose: () => void,
  closeDisabled = false,
) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldCloseDialogOnKey(event.key, closeDisabled)) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, closeDisabled]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  return closeRef;
}
