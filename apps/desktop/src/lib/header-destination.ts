import type { Scope } from "./api/scope";

/** Workspaces the header navigates between. Scope is orthogonal (see `Scope`). */
export type Destination = "library" | "discover" | "environments" | "scope";

/** Everything clickable in the header nav: destinations plus the scope segment. */
export type HeaderDestination =
  | "library"
  | "discover"
  | "environments"
  | "global"
  | "project";

/** @deprecated Use `Destination`. */
export type HeaderWorkspaceFocus = Destination;

export function activeHeaderDestination(
  destination: Destination,
  scope: Scope,
): HeaderDestination {
  switch (destination) {
    case "library":
      return "library";
    case "discover":
      return "discover";
    case "environments":
      return "environments";
    case "scope":
      switch (scope) {
        case "global":
          return "global";
        case "project":
          return "project";
        default: {
          const neverScope: never = scope;
          return neverScope;
        }
      }
    default: {
      const neverDestination: never = destination;
      return neverDestination;
    }
  }
}

/** Split a header click into the destination it targets and, for the scope segment, the scope. */
export function headerDestinationTarget(
  clicked: HeaderDestination,
): { destination: Destination; scope: Scope | null } {
  switch (clicked) {
    case "library":
    case "discover":
    case "environments":
      return { destination: clicked, scope: null };
    case "global":
      return { destination: "scope", scope: "global" };
    case "project":
      return { destination: "scope", scope: "project" };
    default: {
      const neverClicked: never = clicked;
      return neverClicked;
    }
  }
}

export function headerClickIntent(
  active: HeaderDestination,
  clicked: HeaderDestination,
): "reset" | "switch" {
  return active === clicked ? "reset" : "switch";
}
