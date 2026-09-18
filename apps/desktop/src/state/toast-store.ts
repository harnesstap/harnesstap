import { useSyncExternalStore } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

export interface Toast extends ToastInput {
  id: number;
}

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_AUTO_DISMISS_MS = 4000;

export interface ToastStore {
  getState: () => readonly Toast[];
  subscribe: (listener: () => void) => () => void;
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

/** Errors stay until dismissed; everything else auto-dismisses. */
export function toastAutoDismissMs(tone: ToastTone): number | null {
  switch (tone) {
    case "error":
      return null;
    case "success":
    case "info":
      return TOAST_AUTO_DISMISS_MS;
    default: {
      const neverTone: never = tone;
      return neverTone;
    }
  }
}

export function createToastStore(
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
): ToastStore {
  let visible: Toast[] = [];
  const queue: Toast[] = [];
  const timers = new Map<number, () => void>();
  const listeners = new Set<() => void>();
  let nextId = 1;

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const show = (toast: Toast) => {
    visible = [...visible, toast];
    const ms = toastAutoDismissMs(toast.tone);
    if (ms !== null) {
      timers.set(toast.id, schedule(() => dismiss(toast.id), ms));
    }
  };

  const dismiss = (id: number) => {
    const cancel = timers.get(id);
    if (cancel) {
      cancel();
      timers.delete(id);
    }
    const queuedIndex = queue.findIndex((toast) => toast.id === id);
    if (queuedIndex >= 0) {
      queue.splice(queuedIndex, 1);
      return;
    }
    if (!visible.some((toast) => toast.id === id)) {
      return;
    }
    visible = visible.filter((toast) => toast.id !== id);
    const next = queue.shift();
    if (next) {
      show(next);
    }
    emit();
  };

  return {
    getState: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toast(input) {
      const toast: Toast = { ...input, id: nextId++ };
      if (visible.length < MAX_VISIBLE_TOASTS) {
        show(toast);
        emit();
      } else {
        queue.push(toast);
      }
      return toast.id;
    },
    dismiss,
    clear() {
      for (const cancel of timers.values()) {
        cancel();
      }
      timers.clear();
      queue.length = 0;
      visible = [];
      emit();
    },
  };
}

export const toastStore: ToastStore = createToastStore();

export function toast(input: ToastInput): number {
  return toastStore.toast(input);
}

export function dismissToast(id: number): void {
  toastStore.dismiss(id);
}

export function useToasts(store: ToastStore = toastStore): readonly Toast[] {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
