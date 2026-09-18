import type { ViewScope } from "../types";

/** UI scope. The agent wire format still calls the global scope `home`. */
export type Scope = "global" | "project";

export function scopeToView(scope: Scope): ViewScope {
  switch (scope) {
    case "global":
      return "home";
    case "project":
      return "project";
    default: {
      const neverScope: never = scope;
      return neverScope;
    }
  }
}

export function viewToScope(view: ViewScope): Scope {
  switch (view) {
    case "home":
      return "global";
    case "project":
      return "project";
    default: {
      const neverView: never = view;
      return neverView;
    }
  }
}

export function formatScope(scope: Scope): string {
  switch (scope) {
    case "global":
      return "Global";
    case "project":
      return "Project";
    default: {
      const neverScope: never = scope;
      return neverScope;
    }
  }
}

/** Format a wire-scope value with the UI name (`home` reads as Global). */
export function formatView(view: ViewScope): string {
  return formatScope(viewToScope(view));
}
