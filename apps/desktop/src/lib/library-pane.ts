export type EscapeAction = "cancel-field" | "dismiss-confirm" | "leave-pane";
export type SidebarChangeAction = "block" | "leave-and-apply" | "confirm-discard";

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
  draftTyped: boolean;
}): SidebarChangeAction {
  if (input.busy) {
    return "block";
  }
  if (input.confirmOpen) {
    return "block";
  }
  if (input.draftTyped) {
    return "confirm-discard";
  }
  return "leave-and-apply";
}

export function draftHasTypedContent(input: {
  name: string;
  description: string;
}): boolean {
  return input.name.trim().length > 0 || input.description.trim().length > 0;
}

const LIBRARY_BACK_LABEL = "Back to library list";

const INCIDENTAL_DRAFT_LEAVE_LABELS = [
  LIBRARY_BACK_LABEL,
  "Import into library",
  "Tracked directories",
  "Create plugin",
] as const;

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

export function isIncidentalDraftLeaveTarget(
  target: EventTarget | null,
): boolean {
  return INCIDENTAL_DRAFT_LEAVE_LABELS.some((label) =>
    controlHasAriaLabel(target, label),
  );
}

export function shouldCommitDraftName(input: {
  leaving: boolean;
  name: string;
  relatedTarget?: EventTarget | null;
  connected?: boolean;
}): boolean {
  if (input.connected === false) {
    return false;
  }
  if (input.leaving) {
    return false;
  }
  if (isIncidentalDraftLeaveTarget(input.relatedTarget ?? null)) {
    return false;
  }
  return input.name.trim().length > 0;
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
  | { mode: "detail"; target: LibraryDetailTarget }
  | { mode: "create-draft"; name: string; description: string };
