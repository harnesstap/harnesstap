/**
 * Workspaces the header tabs navigate between. `"scope"` is the Profile tab
 * (Global and Project profiles); which of the two it shows is `Scope`.
 */
export type Destination =
  | "library"
  | "discover"
  | "environments"
  | "harnesses"
  | "scope";

/** @deprecated Use `Destination`. */
export type HeaderWorkspaceFocus = Destination;

export function headerClickIntent(
  active: Destination,
  clicked: Destination,
): "reset" | "switch" {
  return active === clicked ? "reset" : "switch";
}
