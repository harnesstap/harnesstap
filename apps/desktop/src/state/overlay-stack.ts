import { useEffect, useRef, type RefObject } from "react";

/**
 * One layer manager for every overlay (dialogs, full-screen panels, popovers).
 * Only the top layer receives Esc and traps Tab; focus returns to the opener.
 */

export interface OverlayLayer {
  id: number;
  getRoot: () => HTMLElement | null;
  onClose: () => void;
  isCloseDisabled: () => boolean;
  trapFocus: boolean;
}

export type EscapeOutcome = "closed" | "blocked" | "fallback" | "none";

interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

export interface OverlayStack {
  push: (layer: Omit<OverlayLayer, "id">) => number;
  remove: (id: number) => void;
  top: () => OverlayLayer | null;
  size: () => number;
  isEmpty: () => boolean;
  pushFallback: (handler: (event: KeyboardEvent) => void) => () => void;
  /** Route Esc to the top layer, else to the newest fallback handler. */
  dispatchEscape: (event: KeyEventLike) => EscapeOutcome;
}

export function createOverlayStack(): OverlayStack {
  const layers: OverlayLayer[] = [];
  const fallbacks: Array<(event: KeyboardEvent) => void> = [];
  let nextId = 1;
  return {
    push(layer) {
      const id = nextId++;
      layers.push({ ...layer, id });
      return id;
    },
    remove(id) {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) {
        layers.splice(index, 1);
      }
    },
    top: () => layers[layers.length - 1] ?? null,
    size: () => layers.length,
    isEmpty: () => layers.length === 0,
    pushFallback(handler) {
      fallbacks.push(handler);
      return () => {
        const index = fallbacks.lastIndexOf(handler);
        if (index >= 0) {
          fallbacks.splice(index, 1);
        }
      };
    },
    dispatchEscape(event) {
      const top = layers[layers.length - 1];
      if (top) {
        if (top.isCloseDisabled()) {
          return "blocked";
        }
        event.preventDefault();
        top.onClose();
        return "closed";
      }
      const fallback = fallbacks[fallbacks.length - 1];
      if (fallback) {
        fallback(event as KeyboardEvent);
        return "fallback";
      }
      return "none";
    },
  };
}

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
  "[contenteditable=\"true\"]",
].join(",");

export function tabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("hidden")
      && element.getAttribute("aria-hidden") !== "true"
      && element.getClientRects().length > 0,
  );
}

/**
 * Where Tab should land inside a trapped layer. Returns `null` when the
 * browser's default move stays inside the layer.
 */
export function nextTabTarget<T>(
  tabbables: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | null {
  const first = tabbables[0];
  const last = tabbables[tabbables.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  const index = active === null ? -1 : tabbables.indexOf(active);
  if (index < 0) {
    return shiftKey ? last : first;
  }
  if (shiftKey && index === 0) {
    return last;
  }
  if (!shiftKey && index === tabbables.length - 1) {
    return first;
  }
  return null;
}

export const overlayStack: OverlayStack = createOverlayStack();

let listenerCount = 0;

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) {
    return;
  }
  if (event.key === "Escape") {
    overlayStack.dispatchEscape(event);
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const top = overlayStack.top();
  if (!top || !top.trapFocus) {
    return;
  }
  const root = top.getRoot();
  if (!root) {
    return;
  }
  const active = document.activeElement;
  const activeInLayer = active instanceof HTMLElement && root.contains(active);
  const activeIsBody = active === null || active === document.body;
  // Focus inside a portal (menus, selects) manages itself; leave it alone.
  if (!activeInLayer && !activeIsBody) {
    return;
  }
  const tabbables = tabbableElements(root);
  if (tabbables.length === 0) {
    event.preventDefault();
    return;
  }
  const target = nextTabTarget(
    tabbables,
    activeInLayer ? (active as HTMLElement) : null,
    event.shiftKey,
  );
  if (target) {
    event.preventDefault();
    target.focus();
  }
}

function retainWindowListener(): () => void {
  if (listenerCount === 0) {
    window.addEventListener("keydown", onWindowKeyDown);
  }
  listenerCount += 1;
  return () => {
    listenerCount -= 1;
    if (listenerCount === 0) {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  };
}

export interface UseOverlayLayerOptions {
  open: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  /** Focused on open; otherwise the first tabbable inside the layer root. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Return focus to the element that was focused before open (default true). */
  restoreFocus?: boolean;
  /** Cycle Tab inside the layer root (default true; false for popovers). */
  trapFocus?: boolean;
}

/**
 * Register an overlay in the layer stack while `open`. Attach the returned ref
 * to the layer root; when it is not attached, the root is resolved from
 * `initialFocusRef`'s closest `role="dialog"` ancestor.
 */
export function useOverlayLayer<T extends HTMLElement = HTMLDivElement>(
  options: UseOverlayLayerOptions,
): RefObject<T | null> {
  const {
    open,
    onClose,
    closeDisabled = false,
    initialFocusRef,
    restoreFocus = true,
    trapFocus = true,
  } = options;
  const rootRef = useRef<T | null>(null);
  const latest = useRef({ onClose, closeDisabled, initialFocusRef });
  latest.current = { onClose, closeDisabled, initialFocusRef };

  useEffect(() => {
    if (!open) {
      return;
    }
    const opener = document.activeElement;
    const getRoot = (): HTMLElement | null => {
      if (rootRef.current) {
        return rootRef.current;
      }
      const anchor = latest.current.initialFocusRef?.current;
      return anchor?.closest<HTMLElement>("[role=\"dialog\"]") ?? null;
    };
    const release = retainWindowListener();
    const id = overlayStack.push({
      getRoot,
      onClose: () => latest.current.onClose(),
      isCloseDisabled: () => latest.current.closeDisabled,
      trapFocus,
    });
    const timer = window.setTimeout(() => {
      const preferred = latest.current.initialFocusRef?.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      const root = getRoot();
      if (!root) {
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active)) {
        return;
      }
      tabbableElements(root)[0]?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      overlayStack.remove(id);
      release();
      if (
        restoreFocus
        && opener instanceof HTMLElement
        && opener.isConnected
        && opener !== document.body
      ) {
        opener.focus();
      }
    };
  }, [open, restoreFocus, trapFocus]);

  return rootRef;
}

/**
 * Run `handler` on Esc only while no overlay layer is open. Used for
 * "Back on Esc" inside workspaces so an open dialog always wins.
 */
export function useEscapeWhenNoLayer(
  handler: (event: KeyboardEvent) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const release = retainWindowListener();
    const unregister = overlayStack.pushFallback((event) => handlerRef.current(event));
    return () => {
      unregister();
      release();
    };
  }, [enabled]);
}
