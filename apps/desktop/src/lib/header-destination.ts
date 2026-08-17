import type { ViewScope } from "./types";

export type HeaderDestination = "library" | "environments" | "home" | "project";

export type HeaderWorkspaceFocus = "library" | "scope" | "environments";

export function activeHeaderDestination(
  workspaceFocus: HeaderWorkspaceFocus,
  view: ViewScope,
): HeaderDestination {
  switch (workspaceFocus) {
    case "library":
      return "library";
    case "environments":
      return "environments";
    case "scope":
      switch (view) {
        case "home":
          return "home";
        case "project":
          return "project";
        default: {
          const neverView: never = view;
          return neverView;
        }
      }
    default: {
      const neverFocus: never = workspaceFocus;
      return neverFocus;
    }
  }
}

export function headerClickIntent(
  active: HeaderDestination,
  clicked: HeaderDestination,
): "reset" | "switch" {
  return active === clicked ? "reset" : "switch";
}
