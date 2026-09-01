export const DEFAULT_ENV_NONE = "__none__";
export const DEFAULT_ENV_CREATE = "__create__";

export function defaultEnvironmentSelectValue(
  value: string | null,
): string {
  return value ?? DEFAULT_ENV_NONE;
}

export function interpretDefaultEnvironmentChoice(
  next: string,
): "none" | "create" | { kind: "named"; name: string } {
  if (next === DEFAULT_ENV_NONE) {
    return "none";
  }
  if (next === DEFAULT_ENV_CREATE) {
    return "create";
  }
  return { kind: "named", name: next };
}
