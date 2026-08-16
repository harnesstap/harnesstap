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
