import { useRef, type RefObject } from "react";
import { useOverlayLayer } from "../state/overlay-stack";

/** Kept for callers that decide Esc handling themselves (see `useOverlayLayer`). */
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

/**
 * Register a dialog in the overlay layer stack. Returns a ref for a Close
 * control when a caller still needs it; initial focus prefers the first
 * field (or first tabbable) instead of Close.
 */
export function useDialogDismiss(
  open: boolean,
  onClose: () => void,
  closeDisabled = false,
): RefObject<HTMLButtonElement | null> {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useOverlayLayer({
    open,
    onClose,
    closeDisabled,
  });
  return closeRef;
}
