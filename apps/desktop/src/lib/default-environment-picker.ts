export const DEFAULT_ENV_CREATE = "__create__";

/** Copy for the Default environment field in the Edit profile pane. */
export const DEFAULT_ENV_COPY = {
  label: "Default environment",
  add: "Add default environment",
  addTooltip: "Pick the environment this profile uses on Apply",
  remove: "Remove default environment",
  create: "Create a new environment",
  none: "No environments yet.",
} as const;

/**
 * Empty shows only the Add button; set shows the dropdown and the remove x.
 * The dropdown never offers "None": removing goes through the x.
 */
export function defaultEnvironmentFieldState(value: string | null): "empty" | "set" {
  return value ? "set" : "empty";
}

/** Add preselects the first environment in the list. */
export function firstEnvironmentName(environments: ReadonlyArray<{ name: string }>): string | null {
  return environments[0]?.name ?? null;
}

export function interpretDefaultEnvironmentChoice(next: string): "create" | { kind: "named"; name: string } {
  if (next === DEFAULT_ENV_CREATE) {
    return "create";
  }
  return { kind: "named", name: next };
}
