export type SourcesPane =
  | { mode: "list" }
  | { mode: "plugin-tree"; hitId: string }
  | { mode: "preview"; hitId: string; filePath?: string };

export function sourcesPaneHasPrevious(pane: SourcesPane): boolean {
  switch (pane.mode) {
    case "list":
      return false;
    case "plugin-tree":
    case "preview":
      return true;
    default: {
      const neverPane: never = pane;
      return neverPane;
    }
  }
}

export function sourcesEscapeAction(input: {
  confirmOpen: boolean;
}): "dismiss-confirm" | "leave-pane" {
  if (input.confirmOpen) return "dismiss-confirm";
  return "leave-pane";
}

export function sourcesSidebarChangeAction(input: {
  busy: boolean;
  confirmOpen: boolean;
}): "block" | "leave-and-apply" {
  if (input.busy || input.confirmOpen) return "block";
  return "leave-and-apply";
}

export function popSourcesPane(pane: SourcesPane): SourcesPane {
  switch (pane.mode) {
    case "list":
      return pane;
    case "plugin-tree":
      return { mode: "list" };
    case "preview":
      return pane.filePath !== undefined
        ? { mode: "plugin-tree", hitId: pane.hitId }
        : { mode: "list" };
    default: {
      const neverPane: never = pane;
      return neverPane;
    }
  }
}
