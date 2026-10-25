import type { Scope } from "./api/scope";

/** Workspaces the header navigates between. Scope is orthogonal (see `Scope`). */
export type Destination =
  | "library"
  | "discover"
  | "environments"
  | "harnesses"
  | "scope";

/** Everything clickable in the header nav: destinations plus the scope segment. */
export type HeaderDestination =
  | "library"
  | "discover"
  | "environments"
  | "harnesses"
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
    case "harnesses":
      return "harnesses";
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

/** Tooltip on the disabled Project scope button while Harnesses is open. */
export const HARNESS_GLOBAL_SCOPE_TOOLTIP =
  "Harness settings are global. Set a project override in Settings > Project.";

export interface HeaderScopeState {
  /** Scope the segment shows as selected. */
  scope: Scope;
  /** Set when the current destination has no project scope; Project is disabled. */
  projectDisabledReason: string | null;
}

/**
 * What the header Scope segment shows for a destination. Harnesses is the
 * machine-wide registry, so it always reads Global and leaves the shared
 * scope untouched for the scoped destinations.
 */
export function headerScopeState(destination: Destination, scope: Scope): HeaderScopeState {
  switch (destination) {
    case "harnesses":
      return { scope: "global", projectDisabledReason: HARNESS_GLOBAL_SCOPE_TOOLTIP };
    case "library":
    case "discover":
    case "environments":
    case "scope":
      return { scope, projectDisabledReason: null };
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
    case "harnesses":
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
