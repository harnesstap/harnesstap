export type EscapeAction = "cancel-field" | "dismiss-confirm" | "leave-pane";
export type SidebarChangeAction = "block" | "leave-and-apply";

export function escapeAction(input: {
  fieldEditing: boolean;
  confirmOpen: boolean;
}): EscapeAction {
  if (input.fieldEditing) {
    return "cancel-field";
  }
  if (input.confirmOpen) {
    return "dismiss-confirm";
  }
  return "leave-pane";
}

export function sidebarChangeAction(input: {
  busy: boolean;
  confirmOpen: boolean;
}): SidebarChangeAction {
  if (input.busy) {
    return "block";
  }
  if (input.confirmOpen) {
    return "block";
  }
  return "leave-and-apply";
}

const LIBRARY_BACK_LABEL = "Back to library list";

function controlHasAriaLabel(
  target: EventTarget | null,
  label: string,
): boolean {
  if (target == null || typeof target !== "object") {
    return false;
  }
  const candidate = target as {
    getAttribute?: (name: string) => string | null;
    closest?: (selector: string) => unknown;
  };
  if (candidate.getAttribute?.("aria-label") === label) {
    return true;
  }
  return candidate.closest?.(`[aria-label="${label}"]`) != null;
}

export function isLibraryBackControl(target: EventTarget | null): boolean {
  return controlHasAriaLabel(target, LIBRARY_BACK_LABEL);
}

export function isOutsideLibraryDetail(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") {
    return true;
  }
  const candidate = target as {
    closest?: (selector: string) => unknown;
  };
  return candidate.closest?.(".library-detail") == null;
}

export type LibraryDetailTarget =
  | {
      kind: "resource";
      selector: string;
      label: string;
      pathHint?: string | null;
    }
  | { kind: "plugin-package"; selector: string };

export type LibraryPane =
  | { mode: "list" }
  | { mode: "detail"; target: LibraryDetailTarget };

export function libraryPaneHasPrevious(pane: LibraryPane): boolean {
  switch (pane.mode) {
    case "list":
      return false;
    case "detail":
      return true;
    default: {
      const neverPane: never = pane;
      return neverPane;
    }
  }
}
