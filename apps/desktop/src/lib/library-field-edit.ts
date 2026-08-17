export type FieldKeyAction = "commit" | "cancel";

export function fieldKeyAction(
  key: string,
  options?: { multiline?: boolean },
): FieldKeyAction | null {
  if (key === "Enter") {
    return options?.multiline ? null : "commit";
  }
  if (key === "Escape") {
    return "cancel";
  }
  return null;
}
