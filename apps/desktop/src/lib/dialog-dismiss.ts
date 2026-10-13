import { type RefObject } from "react";
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
 * Register a dialog in the overlay layer stack. Attach the returned ref to
 * the dialog root so the layer can move focus inside, trap Tab, and restore
 * the opener on close. Pass `initialFocusRef` only when a control other than
 * the first field or first tabbable should take focus (the safe action on a
 * destructive confirm).
 */
export function useDialogDismiss(
  open: boolean,
  onClose: () => void,
  closeDisabled = false,
  initialFocusRef?: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
  return useOverlayLayer<HTMLDivElement>({
    open,
    onClose,
    closeDisabled,
    initialFocusRef,
  });
}
